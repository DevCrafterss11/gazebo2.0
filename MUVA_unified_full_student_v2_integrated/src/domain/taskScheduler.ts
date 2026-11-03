import type { Drone, TaskType, MissionPlan } from '../types/collaboration';
import type { TaskRun, DroneLease, ScheduleRequest, ScheduleResult, ResourcePoolSnapshot, SchedulerState } from '../types/concurrentTasks';
import { seatRequirements, seatsFor } from './collaborationResources';

/** 最大并发任务数 */
const MAX_CONCURRENT_TASKS = 5;

/** 每种任务类型同时最多运行数 */
const MAX_PER_TYPE: Record<TaskType, number> = {
  '区域巡逻': 1,
  '目标搜索': 1,
  '定点监测': 1,
  '物资运输': 1,
  '应急救援': 1,
};

/** 最小起飞间隔秒数（错峰） */
const MIN_TAKEOFF_INTERVAL = 8;

/**
 * 纯函数调度器：负责资源分配和并发限制；教学 Mock 不进行真实空域避碰；错峰秒数仅为建议，不建立自动排队
 * 所有函数都是纯函数，不修改输入参数
 */

/** 检查无人机是否满足任务角色要求 */
export function checkDroneEligibility(
  drone: Drone,
  taskType: TaskType,
  role: string,
  activeLeases: DroneLease[]
): { eligible: boolean; reason: string | null } {
  // 检查是否已被租赁
  const existingLease = activeLeases.find(l => l.droneId === drone.id && l.status !== 'released');
  if (existingLease) {
    return { eligible: false, reason: `已被任务 ${existingLease.runId || '（未知运行记录）'} 租赁` };
  }

  // 检查基础状态
  if (drone.instanceStatus !== 'STANDBY') {
    return { eligible: false, reason: `状态不是待命: ${drone.instanceStatus}` };
  }

  if (drone.connectionStatus !== 'CONNECTED') {
    return { eligible: false, reason: '连接异常' };
  }

  if (drone.battery < 25) {
    return { eligible: false, reason: `电量不足: ${Math.round(drone.battery)}%` };
  }

  if (!drone.available) {
    return { eligible: false, reason: '飞机不可用' };
  }

  // 检查类型和载荷匹配
  const seats = seatsFor(drone, taskType);
  const matchingSeat = seats.find(seat => seat.role === role);
  if (!matchingSeat) {
    const required = seatRequirements[taskType].find(seat => seat.role === role);
    if (required) {
      return { eligible: false, reason: `不符合${role}要求: 需要${required.type}${required.payload ? ' + ' + required.payload : ''}` };
    }
    return { eligible: false, reason: `角色${role}不适配` };
  }

  return { eligible: true, reason: null };
}

/** 计算建议的起飞延迟（错峰） */
export function calculateTakeoffDelay(activeRuns: TaskRun[], now: number): number {
  if (activeRuns.length === 0) return 0;

  // 找到最近起飞的任务
  const recentStarts = activeRuns
    .filter(r => r.lifecycle === 'armed' || r.lifecycle === 'airborne')
    .map(r => r.startedAt)
    .filter(t => now - t < MIN_TAKEOFF_INTERVAL * 1000);

  if (recentStarts.length === 0) return 0;

  const latestStart = Math.max(...recentStarts);
  const elapsed = (now - latestStart) / 1000;

  return Math.max(0, MIN_TAKEOFF_INTERVAL - elapsed);
}

/** 调度请求：尝试分配资源并创建任务运行实例 */
export function scheduleTask(
  request: ScheduleRequest,
  drones: Drone[],
  state: SchedulerState,
  now: number
): ScheduleResult {
  // 检查并发限制
  const activeCount = state.activeRuns.filter(r => r.lifecycle !== 'finished').length;
  if (activeCount >= MAX_CONCURRENT_TASKS) {
    return {
      accepted: false,
      runId: null,
      leases: [],
      reason: `已达最大并发数 ${MAX_CONCURRENT_TASKS}`,
      conflicts: [],
      suggestedDelay: 30,
      unavailableDrones: [],
    };
  }

  // 检查同类型任务限制
  const sameTypeCount = state.activeRuns.filter(
    r => r.taskType === request.taskType && r.lifecycle !== 'finished'
  ).length;
  if (sameTypeCount >= MAX_PER_TYPE[request.taskType]) {
    return {
      accepted: false,
      runId: null,
      leases: [],
      reason: `${request.taskType}任务已在运行，同类型最多 ${MAX_PER_TYPE[request.taskType]} 个`,
      conflicts: [],
      suggestedDelay: 60,
      unavailableDrones: [],
    };
  }

  // Teaching Mock does not model four-dimensional separation. Overlapping routes are
  // permitted here; never claim this is an airspace clearance or collision avoidance.

  if (new Set(request.drones).size !== request.drones.length) return { accepted: false, runId: null, leases: [], reason: '参与无人机重复', conflicts: [], suggestedDelay: 0, unavailableDrones: [] };

  // 检查每架飞机的资格并尝试分配租赁
  const leases: DroneLease[] = [];
  const unavailable: string[] = [];

  for (const droneId of request.drones) {
    const drone = drones.find(d => d.id === droneId);
    if (!drone) {
      unavailable.push(droneId);
      continue;
    }

    const role = request.roles[droneId];
    if (!role) {
      unavailable.push(`${droneId}: 未分配角色`);
      continue;
    }

    const eligibility = checkDroneEligibility(drone, request.taskType, role, state.activeLeases);
    if (!eligibility.eligible) {
      unavailable.push(`${droneId}: ${eligibility.reason}`);
      continue;
    }

    // 获取座位要求
    const seat = seatRequirements[request.taskType].find(s => s.role === role);
    if (!seat) {
      unavailable.push(`${droneId}: 座位${role}不存在`);
      continue;
    }

    // 创建租赁
    leases.push({
      droneId,
      runId: '', // 将在创建 TaskRun 时填充
      taskType: request.taskType,
      role,
      requiredType: seat.type,
      requiredPayload: seat.payload,
      status: 'reserved',
      acquiredAt: now,
      releasedAt: null,
      batteryAtAcquire: drone.battery,
      connectionAtAcquire: drone.connectionStatus,
    });
  }

  // 检查是否全部成功
  if (unavailable.length > 0 && !request.allowPartialStart) {
    return {
      accepted: false,
      runId: null,
      leases: [],
      reason: '资源不足，需要全编组',
      conflicts: [],
      suggestedDelay: 15,
      unavailableDrones: unavailable,
    };
  }

  // 检查最少飞机数
  if (leases.length === 0) {
    return {
      accepted: false,
      runId: null,
      leases: [],
      reason: '没有可用飞机',
      conflicts: [],
      suggestedDelay: 30,
      unavailableDrones: unavailable,
    };
  }

  // 计算起飞延迟
  const suggestedDelay = calculateTakeoffDelay(state.activeRuns, now) + request.startDelay;

  // Resolve the lease owner atomically with the accepted decision (no blank runId).
  const runId = `run-${now}-${state.stats.totalStarted + 1}`;
  return {
    accepted: true,
    runId,
    leases: leases.map(lease => ({ ...lease, runId })),
    reason: null,
    conflicts: [],
    suggestedDelay,
    unavailableDrones: unavailable,
  };
}

/** 释放单架飞机的租赁 */
export function releaseLease(leaseId: string, activeLeases: DroneLease[], now: number): DroneLease[] {
  return activeLeases.map(lease => {
    if (lease.droneId === leaseId && lease.status !== 'released') {
      return { ...lease, status: 'released', releasedAt: now };
    }
    return lease;
  });
}

/** 释放整个任务的所有租赁 */
export function releaseTaskLeases(runId: string, activeLeases: DroneLease[], now: number): DroneLease[] {
  return activeLeases.map(lease => {
    if (lease.runId === runId && lease.status !== 'released') {
      return { ...lease, status: 'released', releasedAt: now };
    }
    return lease;
  });
}

/** 获取资源池快照 */
export function getResourcePoolSnapshot(drones: Drone[], state: SchedulerState, now: number): ResourcePoolSnapshot {
  const leasedDroneIds = new Set(
    state.activeLeases.filter(l => l.status !== 'released').map(l => l.droneId)
  );

  const available = drones.filter(d =>
    d.instanceStatus === 'STANDBY' &&
    d.connectionStatus === 'CONNECTED' &&
    d.battery >= 25 &&
    d.available &&
    !leasedDroneIds.has(d.id)
  ).map(d => d.id);

  const leasedDrones = state.activeLeases
    .filter(l => l.status !== 'released')
    .map(l => ({ droneId: l.droneId, runId: l.runId, role: l.role }));

  return {
    timestamp: now,
    totalDrones: drones.length,
    availableDrones: available,
    leasedDrones,
    runningTasks: state.activeRuns.filter(r => r.lifecycle !== 'finished').length,
    queuedRequests: state.queuedRequests.length,
  };
}

/** 清理已完成任务的租赁 */
export function cleanupFinishedLeases(state: SchedulerState, now: number): SchedulerState {
  const finishedRunIds = new Set(
    state.activeRuns.filter(r => r.lifecycle === 'finished').map(r => r.id)
  );

  const cleanedLeases = state.activeLeases.filter(lease => {
    // 保留未完成任务的租赁
    if (!finishedRunIds.has(lease.runId)) return true;

    // 已完成任务的租赁，如果超过 60 秒则清理
    if (lease.status === 'released' && lease.releasedAt && now - lease.releasedAt > 60000) {
      return false;
    }

    return true;
  });

  return {
    ...state,
    activeLeases: cleanedLeases,
  };
}
