import { pickSeat, resourceCompatibility, seatNeed, seatRequirements, seatsFor } from './collaborationResources';
import type { Drone, TrajectorySample, EvaluationResult, Mission, Position, TaskEvent, TaskGroup, TaskType } from '../types/collaboration';
const interpolate = (points: Position[], fraction: number): Position => {
  const step = Math.min(points.length - 1, Math.max(0, fraction * (points.length - 1)));
  const a = points[Math.floor(step)]!;
  const b = points[Math.min(points.length - 1, Math.floor(step) + 1)]!;
  const t = step - Math.floor(step);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
};
const point = (x: number, y: number, z: number): Position => ({ x, y, z });
const bounds = (group: TaskGroup, index: number) => {
  const input = group.points.filter((p) => p.kind === 'point');
  const cx = input.length ? input.reduce((sum, p) => sum + p.x, 0) / input.length : (index - 2) * 23;
  const cy = input.length ? input.reduce((sum, p) => sum + p.y, 0) / input.length : index % 2 ? -10 : 10;
  const halfX = input.length > 1 ? Math.max(8, ((Math.max(...input.map((p) => p.x)) - Math.min(...input.map((p) => p.x))) / 2)) : index === 1 ? group.config.searchRange / 2 : 17;
  const halfY = input.length > 1 ? Math.max(8, ((Math.max(...input.map((p) => p.y)) - Math.min(...input.map((p) => p.y))) / 2)) : index === 1 ? group.config.searchRange / 2 : 17;
  return { cx, cy, halfX, halfY };
};

// Horizontal scan intersections keep the simple teaching route within the drawn
// polygon. A single search point is expanded by the configured search range.
const scanRoute = (polygon: Position[], spacing: number, z: number): Position[] => {
  const minY = Math.min(...polygon.map((p) => p.y)), maxY = Math.max(...polygon.map((p) => p.y));
  const rows = Math.max(1, Math.min(30, Math.ceil((maxY - minY) / Math.max(2, spacing))));
  const result: Position[] = [];
  for (let row = 0; row < rows; row++) {
    const y = minY + (row + .5) * (maxY - minY) / rows;
    const xs = polygon.flatMap((a, i) => {
      const b = polygon[(i + 1) % polygon.length]!;
      return (a.y > y) !== (b.y > y) ? [a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y)] : [];
    }).sort((a, b) => a - b);
    const spans: Position[] = [];
    for (let i = 0; i + 1 < xs.length; i += 2) spans.push(point(xs[i]!, y, z), point(xs[i + 1]!, y, z));
    result.push(...(row % 2 ? spans.reverse() : spans));
  }
  return result;
};

/** One local-coordinate route model is shared by the drawing and simulated flight. */
export function routePosition(group: TaskGroup, index: number, progress: number): Position {
  const z = group.config.altitude;
  const f = Math.max(0, Math.min(1, progress / 100));
  const { cx, cy, halfX, halfY } = bounds(group, index);
  const markers = group.points.filter((p) => p.kind === 'point');
  const polygon = markers.length >= 3 ? markers.map((p) => point(p.x, p.y, z)) : [point(cx - halfX, cy - halfY, z), point(cx + halfX, cy - halfY, z), point(cx + halfX, cy + halfY, z), point(cx - halfX, cy + halfY, z)];
  if (index === 0) {
    const scan = scanRoute(polygon, group.config.routeSpacing, z);
    const route = group.config.strategy === '顺时针巡逻' || !scan.length ? [...polygon, polygon[0]!] : group.config.strategy === '分区巡逻' ? scan.reverse() : scan;
    return interpolate(route, f);
  }
  if (index === 1) {
    const scan = scanRoute(polygon, group.config.routeSpacing, z);
    const fan = polygon.flatMap((p) => [point(cx, cy, z), p]);
    return interpolate(group.config.strategy === '扇形搜索' ? fan : group.config.strategy === '协同搜索' ? scan.slice().reverse() : scan.length ? scan : polygon, f);
  }
  if (index === 2) {
    const target = markers[0] ?? point(cx, cy, z);
    const base = point(cx - 25, cy - 18, z);
    return f < .28 ? interpolate([base, point(target.x, target.y, z)], f / .28) : point(target.x, target.y, z);
  }
  if (index === 3) {
    const start = group.points.find((p) => p.kind === 'start') ?? point(-45, -25, z);
    const delivery = group.points.find((p) => p.kind === 'delivery') ?? point(43, -25, z);
    const waypoints = markers.map((p) => point(p.x, p.y, z));
    return interpolate([point(start.x, start.y, z), ...waypoints, point(delivery.x, delivery.y, z)], f);
  }
  const target = group.points.find((p) => p.kind === 'delivery') ?? markers.at(-1) ?? point(46, 30, z);
  const start = group.points.find((p) => p.kind === 'start') ?? point(-40, 30, z);
  const via = group.config.strategy === '先侦察后救援' ? [point(cx, cy, z)] : group.config.strategy === '并行救援' ? markers.map((p) => point(p.x, p.y, z)) : [];
  return interpolate([point(start.x, start.y, z), ...via, point(target.x, target.y, z)], f);
}
export const routeSamples = (group: TaskGroup, index: number) => group.plan ? group.plan.routes.flatMap(r => r.waypoints) : Array.from({ length: 41 }, (_, i) => routePosition(group, index, i * 2.5));

export function evaluateMission(mission: Mission, events: TaskEvent[], duration: number, status?: string): EvaluationResult {
  const executed = mission.groups.filter((group) => group.runId !== null);
  const results = executed.map((group) => {
    const index = mission.groups.indexOf(group);
    const participants = group.drones.map((id) => mission.drones.find((d) => d.id === id)).filter((d): d is Drone => !!d);
    if (group.plan && group.execution) {
      const ex = group.execution;
      const total = group.plan.routes.reduce((sum, r) => sum + r.length, 0);
      const progress = `${Math.round(group.progress)}%`;
      const metrics = index === 0 ? [{ label: '覆盖航段完成率', value: progress }, { label: '绘制区域面积', value: `${group.plan.area.toFixed(1)} m²` }]
        : index === 1 ? [{ label: '搜索航线完成率', value: progress }, { label: '演练目标确认', value: ex.targetFound ? `${ex.confirmedBy.length} 架取得模拟回执` : '未满足确认条件' }]
        : index === 2 ? [{ label: '实际驻留总时长', value: `${ex.aircraft.reduce((sum,a) => sum + a.dwell, 0).toFixed(1)} s` }, { label: '接力次数', value: String(ex.handovers) }, { label: '监测空窗', value: `${ex.gapSeconds.toFixed(1)} s` }]
        : index === 3 ? [{ label: '运输航线完成率', value: progress }, { label: '模拟交付', value: group.outcome === 'success' ? '已确认' : '未通过验收' }]
        : [{ label: '侦察确认', value: ex.reconConfirmed ? '已人工确认' : '未要求或未确认' }, { label: '模拟现场处置', value: group.outcome === 'success' ? '已确认' : '未通过验收' }];
      metrics.push({ label: '规划总航程（含返航）', value: `${total.toFixed(0)} m` });
      return { groupId: group.id, status: group.status, participants: group.drones, metrics, trajectorySamples: participants.reduce((sum, d) => sum + d.trajectory.length, 0) };
    }
    const samples = participants.reduce((sum, d) => sum + d.trajectory.length, 0);
    const planned = routeSamples(group, index);
    const primary = participants.reduce<TrajectorySample[]>((best, d) => d.trajectory.length > best.length ? d.trajectory : best, []);
    const actual = participants.flatMap((d) => d.trajectory);
    const distance = (a: Position, b: Position) => Math.hypot(a.x - b.x, a.y - b.y);
    const plannedLength = planned.slice(1).reduce((sum, p, i) => sum + distance(p, planned[i]!), 0);
    const traveledLength = primary.slice(1).reduce((sum, p, i) => sum + distance(p, primary[i]!), 0);
    // Exclude ingress distance from route completion; it must not turn a short
    // aborted route into a falsely successful delivery.
    const routeRate = Math.min(Math.round(group.progress), Math.min(100, Math.round(100 * traveledLength / Math.max(1, plannedLength))));
    const covered = planned.filter((p) => actual.some((sample) => distance(p, sample) < 5)).length;
    const coverage = `${Math.min(100, Math.round(100 * covered / planned.length))}%`;
    const target = routePosition(group, index, 100);
    const arrived = participants.some((d) => d.trajectory.some((p) => distance(p, target) < 8)) && group.status === 'COMPLETE';
    const dwell = group.dwellTicks ?? primary.filter((p) => distance(p, target) < 5).length;
    const response = primary.findIndex((p) => distance(p, target) < 8);
    const arrivalTime = response >= 0 ? primary[response]?.timestamp : undefined;
    const departureTime = primary[0]?.timestamp;
    // Current traces carry timestamps; older archived traces retain their original .85s cadence.
    const responseSeconds = arrivalTime !== undefined && departureTime !== undefined ? (arrivalTime - departureTime) / 1000 : (response + 1) * .85;
    const metrics = index === 0 ? [{ label: '区域覆盖率', value: coverage }, { label: '航线完成率', value: `${routeRate}%` }]
      : index === 1 ? [{ label: '搜索覆盖率', value: coverage }, { label: '目标发现数量', value: String(events.filter((e) => e.groupId === group.id && e.title === '模拟目标发现').length) }]
      : index === 2 ? [{ label: '监测点完成率', value: group.status === 'COMPLETE' && dwell * .85 >= group.config.duration ? '100%' : '0%' }, { label: '有效监测时长', value: `${Math.round(dwell * .85)} s` }]
      : index === 3 ? [{ label: '运输航线完成率', value: `${routeRate}%` }, { label: '交付确认', value: arrived ? (events.some((e) => e.groupId === group.id && e.title === '模拟人工结果确认') ? '已模拟人工签收' : '已到点确认') : '未交付' }]
      : [{ label: '目标到达', value: arrived ? '已到达' : '未到达' }, { label: '响应时间', value: response >= 0 ? `${Math.round(responseSeconds)} s` : '未到达' }];
    return { groupId: group.id, status: group.status, participants: group.drones, metrics, trajectorySamples: samples };
  });
  return { status: status ?? (executed.some((g) => g.status === 'FAILED') ? '部分完成' : '已完成'), completion: Math.round(executed.reduce((sum, g) => sum + g.progress, 0) / Math.max(1, executed.length)), duration, droneCount: new Set(executed.flatMap((g) => g.drones)).size, completedGroups: executed.filter((g) => g.status === 'COMPLETE').length, failedGroups: executed.filter((g) => g.status === 'FAILED').length, anomalyCount: events.filter((e) => e.title === '模拟通信中断' || e.title === '模拟低电量告警' || e.title === '任务资源退出告警').length, groups: results };
}


export const taskRoles = [['领航机', '协同机', '侦察机'], ['搜索机', '协同机', '中继机'], ['监测机', '协同机', '交接机'], ['运输机', '协同机', '护航机'], ['救援机', '侦察机', '中继机']];
/** Human-readable duty, while internal roles stay stable for planning and saved records. */
export const describeTaskRole = (role: string): string => ({
  '领航机': '主执行 · 巡逻', '搜索机': '主执行 · 搜索', '监测机': '主执行 · 监测',
  '运输机': '主执行 · 运输', '救援机': '主执行 · 救援', '协同机': '协同执行',
  '侦察机': '先行侦察', '中继机': '定点中继演练', '交接机': '轮换接力', '护航机': '护航保障',
}[role] ?? role);
export const instanceLabels: Record<Drone['instanceStatus'], string> = { STOPPED: '已停止', STARTING: '启动中', STANDBY: '待命', FLYING: '执行任务', RETURNING: '返航中', FAULT: '故障' };
/** A shared alert label keeps fleet, map and telemetry aligned with resource state. */
export function droneAlert(drone: Drone): string {
  if (drone.instanceStatus === 'STOPPED' || drone.instanceStatus === 'STARTING') return '';
  if (drone.instanceStatus === 'FAULT' || !drone.available) return '资源异常';
  if (drone.connectionStatus === 'STALE') return '数据过期';
  if (drone.connectionStatus !== 'CONNECTED') return '通信中断';
  return drone.battery < 20 ? '低电量' : '';
}

/** Template membership does not reserve or command an aircraft. Execution uses eligibility below. */
export function assignmentEligibility(drone: Drone, type: string): string {
  return resourceCompatibility(drone, type as TaskType);
}
export function eligibility(drone: Drone, type: string): string {
  if (drone.instanceStatus !== 'STANDBY') return `不可分配：${instanceLabels[drone.instanceStatus]}`;
  if (!drone.available || drone.connectionStatus !== 'CONNECTED' || drone.battery < 20) return '连接异常或电量不足';
  const capability = resourceCompatibility(drone, type as TaskType);
  if (capability) return capability;
  if (drone.assignedTaskId) return '任务占用中';
  if (drone.armed) return '单机已解锁，请先锁定后分配任务';
  return '';
}
export { pickSeat, seatRequirements };
export const minimumTaskDrones = (type: string, group: TaskGroup) => type === '目标搜索' && group.config.confirmation === '双机确认' ? 2 : 1;
/**
 * Staffing gaps that do not depend on live drone state. The resource panel and inspectTask both read this,
 * so what the panel shows is exactly what blocks "generate route". Empty group = no gaps yet (nothing chosen).
 */
export function seatGaps(type: string, group: TaskGroup): string[] {
  const seats = seatRequirements[type as TaskType];
  if (!seats || !group.drones.length) return [];
  const gaps: string[] = [];
  const roles = group.drones.map(id => group.roles[id]);
  const primary = seats.find(seat => seat.primary);
  if (primary && !roles.includes(primary.role)) gaps.push(`至少需要一架${primary.role}（${seatNeed(primary)}），请调整成员岗位`);
  if (type === '应急救援' && group.config.strategy === '先侦察后救援' && !roles.includes('侦察机')) gaps.push('先侦察后救援还差 1 架侦察机（侦察类型 + 摄像头）');
  const required = minimumTaskDrones(type, group);
  const observers = type === '目标搜索' ? roles.filter(role => role === '搜索机' || role === '协同机').length : group.drones.length;
  if (observers < required) gaps.push(`双机确认还差 ${required - observers} 架观测机（需摄像头）`);
  return gaps;
}

function validPolygon(points: Position[]): boolean {
  const cross = (a: Position, b: Position, c: Position) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const area = points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]!; return sum + p.x * q.y - q.x * p.y; }, 0);
  if (Math.abs(area) < 1 || new Set(points.map((p) => `${p.x},${p.y}`)).size !== points.length) return false;
  for (let i = 0; i < points.length; i++) for (let j = i + 2; j < points.length; j++) {
    if (i === 0 && j === points.length - 1) continue;
    const a = points[i]!, b = points[(i + 1) % points.length]!, c = points[j]!, d = points[(j + 1) % points.length]!;
    // Nonadjacent edges may neither cross nor touch/overlap.
    const overlap = Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x)) <= Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x))
      && Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y)) <= Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y));
    if (overlap && cross(a,b,c) * cross(a,b,d) <= 0 && cross(c,d,a) * cross(c,d,b) <= 0) return false;
  }
  return true;
}

/** Shared, actionable checks used by the command UI and the execution gate. */
export function inspectTask(mission: Mission, group: TaskGroup) {
  const index = mission.tasks.findIndex((t) => t.id === group.taskId);
  const type = mission.tasks[index]?.type ?? '';
  const parameters: string[] = [], geometry: string[] = [], members: string[] = [];
  if (!group.name.trim()) parameters.push('请填写任务名称');
  const ranges: [number, number, number, string][] = [[group.config.altitude, 5, 120, '飞行高度']];
  if (type === '区域巡逻') ranges.push([group.config.routeSpacing, 1, 120, '航线间距'], [group.config.coverage, 1, 100, '区域覆盖要求']);
  if (type === '目标搜索') ranges.push([group.config.searchRange, 10, 500, '搜索范围']);
  if (type === '区域巡逻' || type === '目标搜索') ranges.push([group.config.heading ?? 0, 0, 359, '航向角']);
  if (type === '目标搜索') ranges.push([group.config.routeSpacing, 1, 120, '搜索航线间距']);
  if (type === '定点监测') ranges.push([group.config.duration, 1, 120, '停留时间']);
  for (const [value, min, max, label] of ranges) if (!Number.isFinite(value) || value < min || value > max) parameters.push(`${label}应为 ${min}–${max}`);
  if (!group.drones.length) members.push('请先在无人机资源管理中选择参与无人机');
  for (const id of group.drones) {
    const d = mission.drones.find((drone) => drone.id === id);
    const candidate = d && group.plan && d.assignedTaskId === group.plan.id ? { ...d, assignedTaskId: null, armed: false } : d;
    if (!candidate || eligibility(candidate, type)) members.push(`${id}：${candidate ? eligibility(candidate, type) : '资源不存在'}`);
    const role = group.roles[id] ?? '';
    if (!taskRoles[index]?.includes(role)) members.push(`${id}：请配置有效任务角色`);
    else if (candidate && !seatsFor(candidate, type as TaskType).some(seat => seat.role === role)) members.push(`${id}：不能担任${role}，请换岗位或改装`);
  }
  if (type === '定点监测' && group.config.strategy === '持续驻留' && group.drones.length !== 1) members.push('持续驻留请选择一架无人机；多机接力请选择轮换监测');
  if (new Set(group.drones).size !== group.drones.length) members.push('参与无人机重复');
  members.push(...seatGaps(type, group));
  const polygon = group.points.filter((p) => p.kind === 'point');
  if (type === '区域巡逻' && polygon.length < 3) geometry.push('请绘制至少三个顶点的任务区域');
  if (type === '目标搜索' && polygon.length === 0) geometry.push('请绘制搜索区域或设置搜索目标点');
  if (type === '目标搜索' && polygon.length === 2) geometry.push('搜索需要一个目标点，或至少三个顶点的区域');
  if ((type === '区域巡逻' || type === '目标搜索' || type === '应急救援') && polygon.length >= 3 && !validPolygon(polygon)) geometry.push('区域顶点不能重合、共线或交叉，请重新绘制');
  if (type === '定点监测' && polygon.length !== 1) geometry.push('请设置一个监测点，重新点击地图可替换位置');
  if ((type === '物资运输' || type === '应急救援') && (!group.points.some((p) => p.kind === 'start') || !group.points.some((p) => p.kind === 'delivery'))) geometry.push('请配置起点和交付 / 救援目标点');
  if (group.points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 20000 || Math.abs(p.y) > 20000)) geometry.push('地图坐标必须为有限数值，且在原点 20 km 的模拟范围内');
  return { parameters, geometry, members };
}
export function validateTask(mission: Mission, group: TaskGroup): string[] {
  const checks = inspectTask(mission, group);
  return [...checks.parameters, ...checks.geometry, ...checks.members];
}
