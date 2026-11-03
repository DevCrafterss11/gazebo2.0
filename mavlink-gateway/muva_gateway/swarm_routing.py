from __future__ import annotations

import heapq
import math

from .commands import CommandRejectedError


def hits_box(first: list[float], second: list[float], box: list[float]) -> bool:
    lower, upper = 0.0, 1.0
    for axis in (0, 1):
        direction = second[axis] - first[axis]
        if abs(direction) < 1e-9:
            if first[axis] < box[axis] or first[axis] > box[axis + 2]:
                return False
        else:
            start, end = sorted(((box[axis] - first[axis]) / direction, (box[axis + 2] - first[axis]) / direction))
            lower, upper = max(lower, start), min(upper, end)
            if lower > upper:
                return False
    return True


def segment_distance(first: list[list[float]], second: list[list[float]]) -> float:
    start, end = first
    other_start, other_end = second
    cross = lambda before, after, point: (after[0] - before[0]) * (point[1] - before[1]) - (after[1] - before[1]) * (point[0] - before[0])
    if cross(start, end, other_start) * cross(start, end, other_end) < 0 and cross(other_start, other_end, start) * cross(other_start, other_end, end) < 0:
        return 0.0
    def point_distance(point: list[float], before: list[float], after: list[float]) -> float:
        delta = [after[axis] - before[axis] for axis in (0, 1)]
        squared = sum(value * value for value in delta)
        along = max(0, min(1, sum((point[axis] - before[axis]) * delta[axis] for axis in (0, 1)) / squared)) if squared else 0
        return math.dist(point, [before[axis] + along * delta[axis] for axis in (0, 1)])
    return min(point_distance(start, other_start, other_end), point_distance(end, other_start, other_end),
               point_distance(other_start, start, end), point_distance(other_end, start, end))


def timed_paths_violate_separation(first: list[list[float]], first_start: float,
                                   second: list[list[float]], second_start: float,
                                   clearance: float, speed: float) -> bool:
    """Check minimum separation while two waypoint routes are concurrently flown."""
    def segments(path: list[list[float]], start: float):
        elapsed = start
        for before, after in zip(path, path[1:]):
            duration = math.dist(before, after) / speed
            if duration > 1e-9:
                yield before, after, elapsed, elapsed + duration
            elapsed += duration

    def position(segment: tuple[list[float], list[float], float, float], at: float) -> list[float]:
        before, after, start, end = segment
        ratio = max(0.0, min(1.0, (at - start) / (end - start)))
        return [before[axis] + (after[axis] - before[axis]) * ratio for axis in (0, 1)]

    first_segments = list(segments(first, first_start))
    second_segments = list(segments(second, second_start))
    first_end = first_segments[-1][3] if first_segments else first_start
    second_end = second_segments[-1][3] if second_segments else second_start
    horizon = max(first_end, second_end)
    if first and horizon > first_end:
        first_segments.append((first[-1], first[-1], first_end, horizon))
    if second and horizon > second_end:
        second_segments.append((second[-1], second[-1], second_end, horizon))
    for first_segment in first_segments:
        for second_segment in second_segments:
            start = max(first_segment[2], second_segment[2])
            end = min(first_segment[3], second_segment[3])
            if start > end:
                continue
            first_at_start = position(first_segment, start)
            second_at_start = position(second_segment, start)
            first_at_end = position(first_segment, end)
            second_at_end = position(second_segment, end)
            relative_start = [first_at_start[axis] - second_at_start[axis] for axis in (0, 1)]
            relative_velocity = [(first_at_end[axis] - second_at_end[axis]) - relative_start[axis] for axis in (0, 1)]
            velocity_squared = sum(value * value for value in relative_velocity)
            ratio = max(0.0, min(1.0, -sum(relative_start[axis] * relative_velocity[axis] for axis in (0, 1)) / velocity_squared)) if velocity_squared else 0.0
            closest = [relative_start[axis] + ratio * relative_velocity[axis] for axis in (0, 1)]
            if math.hypot(*closest) < clearance:
                return True
    return False


def shortest_route(first: list[float], second: list[float], boxes: list[list[float]]) -> list[list[float]]:
    valid = lambda point: all(abs(value) <= 500 for value in point) and not any(hits_box(point, point, box) for box in boxes)
    if not valid(first) or not valid(second):
        raise CommandRejectedError("返航端点位于禁飞缓冲或其他无人机等待安全范围内")
    points = [first, second]
    for left, bottom, right, top in boxes:
        points.extend(point for point in ([left - .1, bottom - .1], [left - .1, top + .1], [right + .1, bottom - .1], [right + .1, top + .1]) if valid(point))
    costs = {0: 0.0}
    parents: dict[int, int] = {}
    queue = [(0.0, 0)]
    while queue:
        cost, current = heapq.heappop(queue)
        if cost > costs[current]:
            continue
        if current == 1:
            path = [points[current]]
            while current in parents:
                current = parents[current]
                path.append(points[current])
            return list(reversed(path))
        for index, point in enumerate(points):
            candidate = cost + math.dist(points[current], point)
            if candidate < costs.get(index, math.inf) and not any(hits_box(points[current], point, box) for box in boxes):
                costs[index] = candidate
                parents[index] = current
                heapq.heappush(queue, (candidate, index))
    raise CommandRejectedError("无法在禁飞缓冲和机间安全间距下返航；保持悬停，请调整任务")


def plan_parallel_routes(paths: list[list[list[float]]], clearance: float, speed: float,
                         landing_seconds: float) -> dict:
    """Reserve next segments, yielding only crossing traffic, with no fleet-wide barrier."""
    from itertools import permutations

    if not paths or any(not path for path in paths) or not math.isfinite(speed) or speed <= 0:
        raise CommandRejectedError("并行调度缺少有效航线或速度")
    original = tuple(range(len(paths)))
    if any(math.dist(paths[index][0], paths[other][0]) < clearance - .01
           for index in original for other in range(index + 1, len(paths))):
        raise CommandRejectedError("服务起降点不足安全间距，请重新初始化机群")

    def simulate(order: tuple[int, ...]) -> dict | None:
        positions = [path[0] for path in paths]
        cursors = [1 for _ in paths]
        active: dict[int, tuple[list[list[float]], float, float]] = {}
        landing: dict[int, float] = {}
        landed: set[int] = set()
        waits = [0.0 for _ in paths]
        at, maximum = 0.0, 0
        for _ in range(sum(len(path) for path in paths) * 3 + len(paths)):
            for index, (segment, start, end) in list(active.items()):
                ratio = min(1, (at - start) / (end - start))
                positions[index] = [segment[0][axis] + ratio * (segment[1][axis] - segment[0][axis]) for axis in (0, 1)]
                if end <= at + 1e-8:
                    positions[index] = segment[1]
                    cursors[index] += 1
                    del active[index]
            for index, end in list(landing.items()):
                if end <= at + 1e-8:
                    landed.add(index)
                    del landing[index]
            for index in order:
                if index in landed or index in active or index in landing:
                    continue
                while cursors[index] < len(paths[index]) and math.dist(positions[index], paths[index][cursors[index]]) < 1e-8:
                    cursors[index] += 1
                if cursors[index] >= len(paths[index]):
                    landing[index] = at + max(.01, landing_seconds)
                    continue
                segment = [positions[index], paths[index][cursors[index]]]
                if any(segment_distance(segment, [position, position]) < clearance - .01
                       for other, position in enumerate(positions) if other != index and other not in landed):
                    continue
                if any(segment_distance(segment, reservation[0]) < clearance - .01
                       for other, reservation in active.items() if other != index):
                    continue
                active[index] = (segment, at, at + math.dist(*segment) / speed)
            maximum = max(maximum, len(active))
            if len(landed) == len(paths):
                return {"order": list(order), "duration": at, "waits": waits, "maxConcurrent": maximum}
            next_at = min([reservation[2] for reservation in active.values()] + list(landing.values()), default=math.inf)
            if not math.isfinite(next_at):
                return None
            for index in original:
                if index not in landed and index not in landing and index not in active:
                    waits[index] += next_at - at
            at = next_at
        return None

    for order in permutations(original):
        result = simulate(order)
        if result:
            return result
    raise CommandRejectedError("自动并行避让后仍存在互相占用的等待点，无法安全放行；请重新生成航线以自动重新分配分区")
