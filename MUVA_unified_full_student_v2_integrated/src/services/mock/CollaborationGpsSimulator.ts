import { resolveDroneAttackConfig, parseWaypoints, validateAttackConfig, type BasicAttackConfig } from '../../domain/basicAttackConfig';
import type { Drone, Mission, Position } from '../../types/collaboration';

const zero = (): Position => ({ x: 0, y: 0, z: 0 });
const activeLifecycles = new Set(['执行中', '暂停', '异常', '待结果确认']);
let sequence = 0;
export function canReceiveGpsAttack(mission: Mission, drone: Drone): boolean {
  return !!drone.assignedTaskId && drone.instanceStatus !== 'RETURNING' && drone.instanceStatus !== 'STOPPED'
    && mission.groups.some(g => g.runId === drone.assignedTaskId && g.drones.includes(drone.id) && activeLifecycles.has(g.lifecycle));
}
export function startGpsAttack(mission: Mission, config: BasicAttackConfig): Mission {
  const errors = validateAttackConfig(config, mission.drones.map(d => d.id));
  if (config.attackType !== 'GPS_SPOOFING' || Object.keys(errors).length) throw new Error(Object.values(errors)[0] ?? '目前仅支持 GPS 欺骗执行');
  if (!config.targetDroneIds.length) throw new Error('请先选择至少一架任务无人机');
  const targets = new Set(config.targetDroneIds);
  for (const d of mission.drones.filter(d => targets.has(d.id))) {
    if (!canReceiveGpsAttack(mission, d)) throw new Error(`${d.id} 未参与正在运行的任务，请启动对应任务或移除目标`);
    if (d.gpsAttack) throw new Error(`${d.id} 已有 GPS 攻击，请先停止该机攻击`);
  }
  const id = `gps-${Date.now()}-${++sequence}`;
  return { ...mission, drones: mission.drones.map(d => targets.has(d.id) ? { ...d, gpsAttack: {
    id, runId: d.assignedTaskId!, groupId: mission.groups.find(g => g.runId === d.assignedTaskId)!.id,
    config: resolveDroneAttackConfig(config, d.id), elapsed: 0, phase: 'delayed', offset: zero(),
  }, reportedPosition: { ...d.position } } : d) };
}
export function stopGpsAttack(mission: Mission, droneIds?: string[]): Mission {
  return { ...mission, drones: mission.drones.map(d => !droneIds || droneIds.includes(d.id)
    ? { ...d, gpsAttack: undefined, reportedPosition: undefined } : d) };
}
// Stateless seeded noise makes the same configuration and simulation clock reproducible.
function noise(seed: number, sample: number, axis: number, id: string): number {
  let h = (seed ^ sample ^ axis * 374761393) | 0;
  for (const char of id) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967295 * 2 - 1;
}
function offsetAt(d: Drone, seconds: number): Position {
  const a = d.gpsAttack!, v = a.config.values;
  const interval = Math.max(.2, Number(v.interval) / 1000);
  const sample = Math.floor((seconds + 1e-8) / interval), time = sample * interval;
  let point = [Number(v.offsetX), Number(v.offsetY), Number(v.offsetZ)];
  const smooth = (n: number) => v.interpolation === 'smooth' ? n * n * (3 - 2 * n) : n;
  if (v.mode === 'gradual') point = point.map(n => n * smooth(Math.min(1, time / Math.max(.001, Number(v.ramp)))));
  if (v.mode === 'path') {
    const path = parseWaypoints(String(v.waypoints))!;
    // One traversal per duration; looping uses 10 seconds per segment.
    const duration = v.loop ? (path.length - 1) * 10 : Number(v.duration);
    const progress = (v.loop ? time % duration : Math.min(time, duration)) / duration * (path.length - 1);
    const index = Math.min(path.length - 2, Math.floor(progress));
    const t = smooth(progress - index), from = path[index]!, to = path[index + 1]!;
    point = from.map((n, i) => n + (to[i]! - n) * t);
  }
  const scale = { low: .35, medium: .65, high: 1 }[a.config.severity];
  const values = point.map((n, axis) => (n + noise(Number(v.seed), sample, axis, d.id) * Number(v.noise)) * scale);
  const radius = Math.min(Number(v.maxOffset), v.geofence ? Number(v.fenceRadius) : Infinity);
  const factor = Math.min(1, radius / Math.max(.000001, Math.hypot(values[0]!, values[1]!)));
  return { x: values[0]! * factor, y: values[1]! * factor, z: Math.max(Number(v.minAltitude), Math.min(Number(v.maxAltitude), d.position.z + values[2]!)) - d.position.z };
}
export function advanceGpsAttacks(mission: Mission, dt: number): Mission {
  return { ...mission, drones: mission.drones.map(d => {
    const a = d.gpsAttack;
    if (!a) return d;
    const v = a.config.values;
    if (a.runId !== d.assignedTaskId || !canReceiveGpsAttack(mission, d)
      || d.connectionStatus !== 'CONNECTED' && v.disconnect === 'stop') return { ...d, gpsAttack: undefined, reportedPosition: undefined };
    if (d.connectionStatus !== 'CONNECTED' && v.disconnect === 'pause') return { ...d, gpsAttack: { ...a, phase: 'paused', offset: zero() }, reportedPosition: { ...d.position } };
    const elapsed = a.elapsed + dt, seconds = elapsed - Number(v.delay);
    const beyondLimit = d.position.z < Number(v.minAltitude) - .05 || d.position.z > Number(v.maxAltitude) + .05
      || v.geofence && Math.hypot(d.position.x - d.homePosition.x, d.position.y - d.homePosition.y) > Number(v.fenceRadius);
    if (seconds + 1e-8 >= Number(v.duration) || v.stopOnLimit && beyondLimit) return { ...d, gpsAttack: undefined, reportedPosition: undefined };
    const offset = seconds < -1e-8 ? zero() : offsetAt(d, seconds);
    return { ...d, gpsAttack: { ...a, elapsed, phase: seconds < -1e-8 ? 'delayed' : 'active', offset } };
  }) };
}
/** Attach provenance to newly recorded ground-truth samples, including the first affected segment. */
export function finishGpsTelemetry(before: Mission, after: Mission): Mission {
  return { ...after, drones: after.drones.map(d => {
    const prev = before.drones.find(p => p.id === d.id)!;
    const active = prev.gpsAttack?.phase === 'active';
    const trajectory = active && d.trajectory.length > prev.trajectory.length
      ? [...d.trajectory.slice(0, prev.trajectory.length), ...d.trajectory.slice(prev.trajectory.length).map(p => ({ ...p, gpsAttackId: prev.gpsAttack!.id }))] : d.trajectory;
    const a = canReceiveGpsAttack(after, d) ? d.gpsAttack : undefined;
    const offset = a?.offset;
    return { ...d, trajectory, gpsAttack: a, reportedPosition: offset ? { x: d.position.x + offset.x, y: d.position.y + offset.y, z: d.position.z + offset.z } : undefined };
  }) };
}
