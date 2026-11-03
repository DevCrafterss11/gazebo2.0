import { advanceGpsAttacks, finishGpsTelemetry, startGpsAttack, stopGpsAttack } from './CollaborationGpsSimulator';
import { navigationPosition } from '../../domain/collaborationGps';
import { advanceFlightTelemetry, applyFlightCommand } from './CollaborationFlightSimulator';
import { teachingMapReference } from '../../domain/collaborationMap';
import { defaultDroneType, defaultPayload } from '../../domain/collaborationResources';
import type { Drone, Mission, DeploymentReceipt, TaskGroup } from '../../types/collaboration';
import type { CollaborationRuntimeAdapter } from '../collaborationContract';

const names = ['区域巡逻', '目标搜索', '定点监测', '物资运输', '应急救援'];
const colors = ['#2daeff', '#ffa735', '#37d2aa', '#aa86e8', '#ff6b80'];
const defaultDrones = Array.from({ length: 15 }, (_, i) => {
  const n = 101 + i;
  const row = Math.floor(i / 5);
  const col = i % 5;
  return {
    id: `uav${n}`, name: `uav${n}`, droneType: defaultDroneType(i), payload: defaultPayload[defaultDroneType(i)], endurance: 35 + i % 3 * 5, speed: 7 + i % 4,
    battery: 92 + i % 8, position: { x: -10 + col * 5, y: 5 - row * 5, z: 0 }, status: 'WAITING' as const,
    taskGroupId: '', trajectory: [], raspberryPiIp: `192.168.10.${n}`, mode: '待命', armed: false,
    velocity: { x: 0, y: 0, z: 0 }, attitude: [0, 0, 0] as [number, number, number], updatedAt: Date.now(), gazeboStatus: '未启动', sitlStatus: '未启动', mavlinkStatus: '未连接',
    role: '', mapVisible: true, available: true, instanceStatus: 'STOPPED', connectionStatus: 'DISCONNECTED', visibleOnMap: true, assignedTaskId: null, currentRole: '', homePosition: { x: -10 + col * 5, y: 5 - row * 5, z: 0 }, returnTrajectory: [],
  } satisfies Drone;
});

export const createInitialMission = (): Mission => ({
  dataSource: 'Mock',
  mapReference: structuredClone(teachingMapReference),
  tasks: names.map((name, i) => ({ id: `task-${i + 1}`, name, type: name, area: `任务区域 ${String.fromCharCode(65 + i)}`, progress: 0, status: 'WAITING', description: `${name}任务组独立执行`, droneCount: 0, color: colors[i]! })),
  groups: names.map((name, i) => ({ id: `group-${i + 1}`, name: `${name}组`, taskId: `task-${i + 1}`, drones: [], roles: {}, lifecycle: '配置中', runId: null, startedAt: null, endedAt: null, elapsedTicks: 0, mode: i === 1 ? 'LEADER' : i === 3 ? 'RELAY' : 'SYNC', progress: 0, status: 'WAITING', color: colors[i]!, config: { altitude: 24 + i * 3, duration: 8 + i * 2, strategy: ['区域覆盖', '网格搜索', '轮换监测', '定点交付', '优先响应'][i]!, routeSpacing: 12, priority: i === 4 ? '高' : '普通', cargo: i === 3 ? '急救物资 2 kg' : '无', coverage: 85, searchRange: 80, confirmation: i === 3 ? '到点确认' : '双机确认', handover: '重叠监测', heading: 0, headingMode: 'auto', scenario: 'success' }, points: [] })),
  drones: structuredClone(defaultDrones).map((d) => ({ ...d, updatedAt: Date.now() })),
});

import { moveDrone } from './collaborationKinematics';
import { advancePlannedMission } from './CollaborationTaskSimulator';
import { routePosition, evaluateMission } from '../../domain/collaborationMission';
export { routePosition, routeSamples, evaluateMission } from '../../domain/collaborationMission';

/** Task progression and safety returns share one clock; pausing tasks never blocks RTL. */
const samplePeriod = .2;
const formationSpacing = 5;
const formationOffset = (group: Mission['groups'][number], id: string) => (group.drones.indexOf(id) - (group.drones.length - 1) / 2) * formationSpacing;

export function advanceMission(mission: Mission, paused = false, dt = .85): Mission {
  const prepared = advanceGpsAttacks(mission, dt);
  return finishGpsTelemetry(prepared, advanceFlightTelemetry(advanceTaskMission(prepared, paused, dt), dt));
}
function advanceTaskMission(mission: Mission, paused: boolean, dt: number): Mission {
  if (mission.groups.some(g => g.plan && g.execution && ['执行中', '暂停', '异常', '待结果确认', '安全收尾'].includes(g.lifecycle))) return advancePlannedMission(mission, paused, dt);
  const groups = mission.groups.map((g, index) => {
    if (paused || g.status !== 'RUNNING' || g.lifecycle === '异常' || g.lifecycle === '安全收尾' || g.lifecycle === '待结果确认') return g;
    const participants = mission.drones.filter((d) => d.assignedTaskId === g.runId && d.instanceStatus === 'FLYING');
    if (!participants.length) return { ...g, lifecycle: '异常' as const };
    const distanceTo = (progress: number) => {
      const p = routePosition(g, index, progress);
      // The slowest member gates route advancement and arrival. Home spacing
      // must not let a leading aircraft finish while another is still in transit.
      return Math.max(...participants.map((d) => {
        const offset = formationOffset(g, d.id);
        return Math.hypot(p.x + offset - navigationPosition(d).x, p.y - navigationPosition(d).y, p.z - navigationPosition(d).z);
      }));
    };
    const elapsedTicks = g.elapsedTicks + dt / .85;
    const duration = index === 4 ? (g.config.priority === '紧急' ? 24 : g.config.priority === '高' ? 30 : 38) : [38, 44, 20, 30][index]!;
    let dwellTicks = g.dwellTicks ?? 0;
    // Route advancement follows actual movement: wait for transit/takeoff, and cap
    // each next route target to the distance a drone can cover this simulation tick.
    let progress = g.progress;
    if (index === 2 && g.progress >= 28 && distanceTo(100) <= 5) {
      dwellTicks += dt / .85;
      progress = Math.min(100, 28 + 72 * dwellTicks * .85 / g.config.duration);
    } else if (distanceTo(g.progress) <= 10) {
      const next = Math.min(index === 2 ? 28 : 100, g.progress + dt / duration * 100);
      if (distanceTo(next) <= 10) progress = next;
      else {
        let low = g.progress, high = next;
        for (let i = 0; i < 12; i++) { const middle = (low + high) / 2; if (distanceTo(middle) <= 10) low = middle; else high = middle; }
        progress = low;
      }
    }
    const completed = progress >= 100 && distanceTo(100) <= 1;
    const manual = completed && (index === 1 && g.config.confirmation === '人工复核' || index === 3 && g.config.confirmation === '人工签收');
    return { ...g, progress, elapsedTicks, dwellTicks, status: completed && !manual ? 'COMPLETE' as const : 'RUNNING' as const, lifecycle: manual ? '待结果确认' as const : completed ? '安全收尾' as const : g.lifecycle };
  });
  const drones = mission.drones.map((d) => {
    if (d.flightControl) return d;
    if (d.instanceStatus === 'RETURNING') {
      const home = d.homePosition;
      const atHome = Math.hypot(home.x - d.position.x, home.y - d.position.y) <= .25;
      // RTL holds altitude during horizontal transit, then descends over its own home.
      const target = { ...home, z: atHome ? home.z : d.position.z };
      const sample = moveDrone(d, target, dt, true);
      const landed = Math.hypot(sample.position.x - home.x, sample.position.y - home.y, sample.position.z - home.z) <= .05;
      const position = landed ? { ...home } : sample.position;
      return { ...d, ...sample, position, velocity: landed ? { x: 0, y: 0, z: 0 } : sample.velocity,
        attitude: landed ? [0, 0, sample.attitude[2]] as Drone['attitude'] : sample.attitude,
        returnTrajectory: [...d.returnTrajectory, position], instanceStatus: landed ? 'STANDBY' as const : 'RETURNING' as const,
        status: landed ? 'READY' as const : d.status, mode: landed ? '待命' : 'RTL', armed: !landed,
        assignedTaskId: landed ? null : d.assignedTaskId, taskGroupId: landed ? '' : d.taskGroupId,
        currentRole: landed ? '' : d.currentRole, role: landed ? '' : d.role };
    }
    if (d.instanceStatus !== 'FLYING') return d;
    const index = mission.groups.findIndex((g) => g.runId === d.assignedTaskId);
    const g = groups[index];
    if (paused || !g || g.lifecycle === '异常' || g.status === 'FAILED') return { ...d, mode: 'LOITER', battery: Math.max(0, d.battery - dt * 100 / (d.endurance * 60)), velocity: { x: 0, y: 0, z: 0 }, attitude: [0, 0, d.attitude[2]] as Drone['attitude'], updatedAt: Date.now() };
    const route = routePosition(g, index, g.progress);
    const takingOff = d.position.z < route.z - .2 && Math.hypot(d.position.x - d.homePosition.x, d.position.y - d.homePosition.y) < .1;
    const target = { x: takingOff ? d.position.x : route.x + formationOffset(g, d.id), y: takingOff ? d.position.y : route.y, z: route.z };
    const sample = moveDrone(d, target, dt);
    return { ...d, ...sample, trajectory: [...d.trajectory, { ...sample.position, timestamp: Date.now() }],
      mode: g.status === 'COMPLETE' ? 'RTL' : takingOff ? 'TAKEOFF' : g.lifecycle === '待结果确认' || index === 2 && g.progress >= 28 ? 'LOITER' : 'AUTO',
      instanceStatus: g.status === 'COMPLETE' ? 'RETURNING' as const : d.instanceStatus };
  });
  return { ...mission, groups, drones, tasks: mission.tasks.map((t) => { const g = groups.find((item) => item.taskId === t.id)!; return { ...t, status: g.status, progress: g.progress, droneCount: g.drones.length }; }) };
}

export class CollaborationMockRuntime implements CollaborationRuntimeAdapter {
  readonly source = 'Mock' as const;
  startGpsAttack = startGpsAttack;
  stopGpsAttack = stopGpsAttack;
  command = applyFlightCommand;
  deploy(mission: Mission, group: TaskGroup, stage: 'upload' | 'arm'): DeploymentReceipt[] {
    return group.drones.map((id, i) => {
      const d = mission.drones.find(d => d.id === id);
      const accepted = !!d && d.instanceStatus === 'STANDBY' && d.connectionStatus === 'CONNECTED' && d.battery >= 25 && d.available && (!d.armed || !!d.assignedTaskId)
        && (!d.assignedTaskId || d.assignedTaskId === group.plan?.id) && !(stage === 'upload' && group.config.scenario === 'upload-failure' && i === 0);
      return { droneId: id, accepted, detail: accepted ? stage === 'upload' ? `模拟航线回执：${group.plan?.routes.find(r => r.droneId === id)?.waypoints.length ?? 0} 个航点已接收` : '模拟解锁检查通过' : '模拟拒绝：连接、电量、资源占用或预设下发失败，请返回配置检查' };
    });
  }
  createInitialMission(): Mission { return createInitialMission(); }
  evaluate = evaluateMission;
  private missionTimer: ReturnType<typeof setInterval> | null = null;
  private bootTimer: ReturnType<typeof setInterval> | null = null;
  startCluster(onProgress: (progress: number) => void, onReady: () => void, onHeartbeat: () => void): void {
    if (this.bootTimer !== null) return;
    let progress = 0;
    let heartbeatElapsed = 0;
    // One lifecycle clock, not an interval replaced inside its own callback.
    this.bootTimer = setInterval(() => {
      if (progress < 100) {
        progress += 25;
        onProgress(progress);
        if (progress === 100) onReady();
      } else {
        heartbeatElapsed += 450;
        if (heartbeatElapsed >= 1500) { heartbeatElapsed -= 1500; onHeartbeat(); }
      }
    }, 450);
  }
  stopCluster(): void {
    this.stop();
    if (this.bootTimer !== null) clearInterval(this.bootTimer);
    this.bootTimer = null;
  }
  start(getMission: () => Mission, onUpdate: (mission: Mission) => void, isPaused: () => boolean = () => false): void {
    if (this.missionTimer !== null) return;
    this.missionTimer = setInterval(() => onUpdate(advanceMission(getMission(), isPaused(), samplePeriod)), samplePeriod * 1000);
  }
  stop(): void { if (this.missionTimer !== null) clearInterval(this.missionTimer); this.missionTimer = null; }
}
