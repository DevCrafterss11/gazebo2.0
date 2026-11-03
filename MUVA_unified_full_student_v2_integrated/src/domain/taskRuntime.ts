import { initialTaskExecution } from './collaborationPlanning';
import type { TaskRun, DroneLease, TaskRunClockUpdate, SchedulerState } from '../types/concurrentTasks';
import type { TaskGroup, TaskEvent, EvaluationResult } from '../types/collaboration';
import { releaseTaskLeases } from './taskScheduler';

/**
 * 任务运行时管理器：管理独立的任务运行实例
 * 每个 TaskRun 拥有独立的状态、时钟和事件流
 */

let runtimeEventSequence = 0;

/** 从 TaskGroup 创建新的 TaskRun */
export function createTaskRun(runId: string, group: TaskGroup, leases: DroneLease[], now: number): TaskRun {
  if (!group.plan) throw new Error('TaskGroup must have a plan before creating TaskRun');
  const altitudes = group.plan.routes.flatMap(r => r.waypoints.map(p => p.z));
  const altitudeBand: [number, number] = [Math.min(...altitudes), Math.max(...altitudes)];
  return {
    id: runId, groupId: group.id, taskType: leases[0]!.taskType, name: group.name,
    priority: group.config.priority === '紧急' ? 10 : group.config.priority === '高' ? 7 : 5,
    status: 'queued', lifecycle: 'pending', leases: leases.map(l => ({ ...l, runId })),
    plan: structuredClone(group.plan), execution: initialTaskExecution(group),
    startedAt: now, endedAt: null, elapsedSeconds: 0, pausedAt: null, pausedDuration: 0,
    events: [], outcome: null, failureReason: null, evaluation: null, altitudeBand,
    conflictChecksum: `${group.taskId}-${altitudeBand.join('-')}`,
  };
}

/** 更新任务运行时钟 */
export function updateTaskRunClock(
  run: TaskRun,
  update: Partial<TaskRunClockUpdate>,
  now: number
): TaskRun {
  // Store only completed pause intervals. An open interval is calculated for display,
  // not repeatedly added on each clock tick (which would double-count it).
  const elapsedSeconds = run.status === 'paused' || run.pausedAt !== null
    ? run.elapsedSeconds
    : Math.max(0, (now - run.startedAt) / 1000 - run.pausedDuration);
  return { ...run, elapsedSeconds: update.elapsedSeconds ?? elapsedSeconds };

}

/** 暂停任务运行 */
export function pauseTaskRun(run: TaskRun, now: number): TaskRun {
  if (run.status === 'paused') return run;

  return {
    ...run,
    status: 'paused',
    pausedAt: now,
    events: [
      ...run.events,
      {
        id: `run-event-${++runtimeEventSequence}-pause`,
        time: now,
        level: 'info',
        title: '任务暂停',
        detail: `${run.name} 暂停执行`,
        groupId: run.groupId,
        simulated: true,
      },
    ],
  };
}

/** 恢复任务运行 */
export function resumeTaskRun(run: TaskRun, now: number): TaskRun {
  if (run.status !== 'paused' || run.pausedAt === null) return run;

  const pauseDuration = (now - run.pausedAt) / 1000;

  return {
    ...run,
    status: 'running',
    pausedAt: null,
    pausedDuration: run.pausedDuration + pauseDuration,
    events: [
      ...run.events,
      {
        id: `run-event-${++runtimeEventSequence}-resume`,
        time: now,
        level: 'info',
        title: '任务恢复',
        detail: `${run.name} 恢复执行，已暂停 ${pauseDuration.toFixed(1)}s`,
        groupId: run.groupId,
        simulated: true,
      },
    ],
  };
}

/** 取消任务运行 */
export function cancelTaskRun(
  run: TaskRun,
  reason: string,
  state: SchedulerState,
  now: number
): { run: TaskRun; state: SchedulerState } {
  const updatedRun: TaskRun = {
    ...run,
    status: 'cancelled',
    lifecycle: 'returning',
    pausedDuration: run.pausedDuration + (run.pausedAt === null ? 0 : (now - run.pausedAt) / 1000),
    pausedAt: null,
    outcome: 'cancelled',
    failureReason: reason,
    endedAt: null, // only landing completes a cancellation
    events: [
      ...run.events,
      {
        id: `run-event-${++runtimeEventSequence}-cancel`,
        time: now,
        level: 'warning',
        title: '任务取消',
        detail: reason,
        groupId: run.groupId,
        simulated: true,
      },
    ],
  };

  // Cancellation starts RTL; keep leases until the aircraft have landed.
  return { run: updatedRun, state: { ...state, activeRuns: state.activeRuns.map(r => r.id === run.id ? updatedRun : r) } };
}

/** 完成任务运行 */
export function completeTaskRun(
  run: TaskRun,
  outcome: 'success' | 'failure' | 'cancelled',
  evaluation: EvaluationResult,
  failureReason: string | null,
  state: SchedulerState,
  now: number
): { run: TaskRun; state: SchedulerState } {
  const updatedRun: TaskRun = {
    ...run,
    status: outcome === 'success' ? 'completed' : outcome === 'cancelled' ? 'cancelled' : 'failed',
    lifecycle: 'finished',
    outcome,
    failureReason,
    evaluation,
    endedAt: now,
    events: [
      ...run.events,
      {
        id: `run-event-${++runtimeEventSequence}-complete`,
        time: now,
        level: outcome === 'success' ? 'success' : 'warning',
        title: outcome === 'success' ? '任务完成' : outcome === 'cancelled' ? '任务终止' : '任务失败',
        detail: outcome === 'success' ? `${run.name} 成功完成` : failureReason || '任务执行失败',
        groupId: run.groupId,
        simulated: true,
      },
    ],
  };

  // 释放所有租赁
  const updatedLeases = releaseTaskLeases(run.id, state.activeLeases, now);

  // 归档运行记录
  const archivedRuns = [...state.archivedRuns, updatedRun];

  // 从活动列表移除
  const activeRuns = state.activeRuns.filter(r => r.id !== run.id);

  return {
    run: updatedRun,
    state: {
      ...state,
      activeRuns,
      archivedRuns,
      activeLeases: updatedLeases,
      stats: {
        ...state.stats,
        totalCompleted: outcome === 'success' ? state.stats.totalCompleted + 1 : state.stats.totalCompleted,
        totalFailed: outcome === 'failure' ? state.stats.totalFailed + 1 : state.stats.totalFailed,
        totalCancelled: outcome === 'cancelled' ? state.stats.totalCancelled + 1 : state.stats.totalCancelled,
        currentConcurrency: activeRuns.length,
      },
    },
  };
}

/** 添加任务事件 */
export function addTaskEvent(run: TaskRun, event: Omit<TaskEvent, 'id' | 'simulated'>): TaskRun {
  return {
    ...run,
    events: [
      ...run.events,
      {
        ...event,
        id: `event-${Date.now()}-${run.events.length}`,
        simulated: true,
      },
    ],
  };
}

/** 检查任务是否可以安全终止 */
export function canSafelyTerminate(run: TaskRun): boolean {
  // 已完成或已取消的任务不能再次终止
  if (run.status === 'completed' || run.status === 'cancelled') {
    return false;
  }

  // 正在部署的任务可以安全取消
  if (run.status === 'deploying') {
    return true;
  }

  // 运行中的任务需要所有飞机都在返航或已落地
  if (run.status === 'running') {
    const allSafe = run.execution.aircraft.every(a =>
      a.phase === 'done' || a.phase === 'returning' || a.phase === 'queued'
    );
    return allSafe;
  }

  return true;
}

/** 释放单架飞机（部分降级） */
export function releaseSingleDrone(
  run: TaskRun,
  droneId: string,
  reason: string,
  state: SchedulerState,
  now: number
): { run: TaskRun; state: SchedulerState; degraded: boolean } {
  // 更新租赁状态
  const updatedLeases = state.activeLeases.map(lease => {
    if (lease.droneId === droneId && lease.runId === run.id && lease.status !== 'released') {
      return { ...lease, status: 'released' as const, releasedAt: now };
    }
    return lease;
  });

  // 记录事件
  const updatedRun = addTaskEvent(run, {
    time: now,
    level: 'warning',
    title: '飞机退出',
    detail: `${droneId} 退出任务: ${reason}`,
    groupId: run.groupId,
  });

  // 检查是否需要降级
  const remainingDrones = run.leases.filter(l => l.droneId !== droneId).length;
  const degraded = remainingDrones < 2; // 少于2架认为降级

  return {
    run: updatedRun,
    state: {
      ...state,
      activeLeases: updatedLeases,
    },
    degraded,
  };
}
