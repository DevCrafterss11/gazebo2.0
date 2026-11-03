import { routeLength, segmentDistance, type RoutingSegment } from './swarmRouting';
import type { Point } from '../types/swarm';

export interface ParallelRouteSchedule { order: number[]; duration: number; waits: number[]; maxConcurrent: number; }
interface Reservation { segment: RoutingSegment; start: number; end: number; }

export function corridorAvailable(segment: RoutingSegment, waiting: Point[], reserved: RoutingSegment[], clearance: number): boolean {
  return waiting.every((point) => segmentDistance(segment, [point, point]) >= clearance - .01)
    && reserved.every((other) => segmentDistance(segment, other) >= clearance - .01);
}

/** Reserve only the next segment. Crossing traffic waits locally; other routes continue. */
export function planParallelRoutes(paths: Point[][], clearance: number, speed: number, landingSeconds: number): ParallelRouteSchedule {
  if (!paths.length || paths.some((path) => !path.length) || !Number.isFinite(speed) || speed <= 0) throw new Error('并行调度缺少有效航线或速度');
  const original = paths.map((_, index) => index);
  if (paths.some((path, index) => paths.slice(index + 1).some((other) => Math.hypot(path[0]![0] - other[0]![0], path[0]![1] - other[0]![1]) < clearance - .01))) throw new Error('服务起降点不足安全间距，请重新初始化机群');
  const simulate = (order: number[]): ParallelRouteSchedule | null => {
    const positions = paths.map((path) => path[0]!);
    const cursors = paths.map(() => 1);
    const reservations = new Map<number, Reservation>();
    const landing = new Map<number, number>();
    const landed = new Set<number>();
    const waits = paths.map(() => 0);
    let at = 0; let maxConcurrent = 0;
    for (let iteration = 0; iteration < paths.reduce((sum, path) => sum + path.length, 0) * 3 + paths.length; iteration += 1) {
      for (const [index, reservation] of reservations) {
        const ratio = Math.min(1, (at - reservation.start) / (reservation.end - reservation.start));
        positions[index] = [reservation.segment[0][0] + ratio * (reservation.segment[1][0] - reservation.segment[0][0]),
          reservation.segment[0][1] + ratio * (reservation.segment[1][1] - reservation.segment[0][1])];
        if (reservation.end <= at + 1e-8) { positions[index] = reservation.segment[1]; cursors[index]! += 1; reservations.delete(index); }
      }
      for (const [index, end] of landing) if (end <= at + 1e-8) { landed.add(index); landing.delete(index); }
      for (const index of order) {
        if (landed.has(index) || reservations.has(index) || landing.has(index)) continue;
        while (cursors[index]! < paths[index]!.length && Math.hypot(...paths[index]![cursors[index]!]!.map((value, axis) => value - positions[index]![axis]!)) < 1e-8) cursors[index]! += 1;
        const target = paths[index]![cursors[index]!];
        if (!target) { landing.set(index, at + Math.max(.01, landingSeconds)); continue; }
        const segment: RoutingSegment = [positions[index]!, target];
        if (!corridorAvailable(segment, positions.filter((_, other) => other !== index && !landed.has(other)),
          [...reservations].filter(([other]) => other !== index).map(([, reservation]) => reservation.segment), clearance)) continue;
        reservations.set(index, { segment, start: at, end: at + routeLength(segment) / speed });
      }
      maxConcurrent = Math.max(maxConcurrent, reservations.size);
      if (landed.size === paths.length) return { order, duration: at, waits, maxConcurrent };
      const next = Math.min(...[...reservations.values()].map((reservation) => reservation.end), ...landing.values());
      if (!Number.isFinite(next)) return null;
      for (const index of original) if (!landed.has(index) && !landing.has(index) && !reservations.has(index)) waits[index]! += next - at;
      at = next;
    }
    return null;
  };
  const first = simulate(original);
  if (first) return first;
  // A different priority can release an endpoint blocked by another aircraft.
  const permutations = function* (prefix: number[], remaining: number[]): Generator<number[]> {
    if (!remaining.length) { yield prefix; return; }
    for (const value of remaining) yield* permutations([...prefix, value], remaining.filter((other) => other !== value));
  };
  for (const order of permutations([], original)) {
    if (order.every((value, index) => value === index)) continue;
    const result = simulate(order);
    if (result) return result;
  }
  throw new Error('自动并行避让后仍存在互相占用的等待点，无法安全放行；请重新生成航线以自动重新分配分区');
}
