import type { Drone, FlightCommand } from '../types/collaboration';

export const flightCommandLabel = (command: FlightCommand): string => {
  const labels = { arm: '解锁', disarm: '锁定', return: '返航', land: '降落', hold: '悬停', takeoff: '起飞', goto: '飞往坐标', move: '相对移动', yaw: '转向', upload: '下发航线', mode: '切换模式' };
  return command.type === 'mode' ? `切换 ${command.mode}` : labels[command.type];
};
/** Shared availability hints; the adapter rechecks the latest telemetry at acknowledgement. */
export function flightCommandIssue(d: Drone | undefined, c: FlightCommand): string {
  if (!d) return '请先选择无人机';
  if (d.connectionStatus !== 'CONNECTED' || ['STOPPED', 'STARTING', 'FAULT'].includes(d.instanceStatus)) return '飞控未就绪或通信异常';
  if (d.assignedTaskId) return '任务已占用该机；请使用任务暂停或单机返航，避免覆盖任务航线';
  if (!d.available) return '该资源不可用';
  const airborne = d.position.z > d.homePosition.z + .15 || d.instanceStatus === 'FLYING' || d.instanceStatus === 'RETURNING';
  if (c.type === 'disarm') return airborne ? '空中禁止锁定，请先降落' : !d.armed ? '已锁定' : '';
  if (c.type === 'return' || c.type === 'land' || c.type === 'hold') return !d.armed ? '请先解锁起飞' : c.type === 'hold' && !airborne ? '请先起飞' : c.type === 'hold' && d.battery <= 20 ? '低电量不能取消自动返航，请降落或等待返航' : '';
  if (d.instanceStatus === 'RETURNING' && c.type === 'mode' && c.mode === 'LAND') return !d.armed ? '请先解锁' : '';
  if (d.instanceStatus === 'RETURNING' || d.flightControl?.phase === 'landing') return '正在返航或降落，等待落地后操作';
  if (c.type === 'mode') {
    if (c.mode === 'RTL' || c.mode === 'LAND') return !d.armed ? '请先解锁' : '';
    if (c.mode === 'AUTO') return !d.armed || !airborne ? 'AUTO 需要先解锁起飞' : !d.flightControl?.route.length ? '请先下发航线' : '';
    return '';
  }
  if (c.type === 'arm') return d.armed ? '已解锁' : airborne ? '飞行中不可重复解锁' : d.battery < 25 ? '解锁要求电量至少 25%' : '';
  if (c.type === 'upload') {
    if (airborne || d.armed) return '请在地面锁定状态下发航线';
    if (c.waypoints.length < 2 || c.waypoints.length > 50) return '航线需要 2–50 个航点';
    if (c.waypoints.some(p => ![p.x,p.y,p.z].every(Number.isFinite) || Math.abs(p.x) > 1000 || Math.abs(p.y) > 1000 || p.z < d.homePosition.z + 1 || p.z > d.homePosition.z + 120)) return '航点需在 ENU ±1000 m 内，相对 Home 高度 1–120 m';
    return '';
  }
  if (c.type === 'takeoff') return !d.armed ? '请先解锁' : airborne ? '已在飞行中' : !['GUIDED','STABILIZE'].includes(d.mode) ? '请先切换 GUIDED 模式' : !Number.isFinite(c.altitude) || c.altitude < 2 || c.altitude > 120 ? '起飞高度应为 2–120 m' : d.battery <= 20 ? '电量不足，请返航' : '';
  if (!d.armed || !airborne) return '请先解锁起飞';
  if (d.flightControl?.phase === 'takeoff') return '正在爬升，请到达起飞高度后操作';
  if (!['GUIDED','LOITER','STABILIZE'].includes(d.mode)) return '请先切换 GUIDED 或 LOITER 模式';
  if (d.battery <= 20) return '低电量，请返航';
  if (c.type === 'goto' && (![c.target.x,c.target.y,c.target.z].every(Number.isFinite) || Math.abs(c.target.x) > 1000 || Math.abs(c.target.y) > 1000 || c.target.z < d.homePosition.z + 1 || c.target.z > d.homePosition.z + 120)) return '目标需在 ENU ±1000 m 内，相对 Home 高度 1–120 m';
  if (c.type === 'move' && (!Number.isFinite(c.distance) || c.distance <= 0 || c.distance > 50)) return '单次位移应大于 0 且不超过 50 m';
  if (c.type === 'yaw' && (!Number.isFinite(c.degrees) || Math.abs(c.degrees) > 180)) return '单次转向应在 ±180° 内';
  return '';
}

export function flightStateLabel(d: Drone): string {
  if (d.instanceStatus === 'STOPPED') return '未启动';
  if (d.instanceStatus === 'STARTING') return '启动中';
  if (d.instanceStatus === 'FAULT') return '故障';
  if (d.connectionStatus !== 'CONNECTED') return d.connectionStatus === 'STALE' ? '遥测过期' : '通信中断';
  if (d.flightControl) return { ground: d.armed ? '地面已解锁' : '待命', takeoff: '爬升中', hold: '悬停', goto: '坐标飞行', route: '航线飞行', landing: '降落中', return: '返航中' }[d.flightControl.phase];
  return { STOPPED:'未启动', STARTING:'启动中', STANDBY:'待命', FLYING:'执行任务', RETURNING:'返航中', FAULT:'故障' }[d.instanceStatus];
}
