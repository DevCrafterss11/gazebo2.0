import type { SchedulerState, TaskRun } from '../types/concurrentTasks';

const STORAGE_KEY = 'muva-collaboration-scheduler-v1';
const STORAGE_VERSION = 1;

/**
 * 调度器状态持久化：支持刷新恢复和异常处理
 */

/** 初始化调度器状态 */
export function createInitialSchedulerState(): SchedulerState {
  return {
    version: STORAGE_VERSION,
    timestamp: Date.now(),
    activeRuns: [],
    queuedRequests: [],
    archivedRuns: [],
    activeLeases: [],
    stats: {
      totalStarted: 0,
      totalCompleted: 0,
      totalFailed: 0,
      totalCancelled: 0,
      currentConcurrency: 0,
      maxConcurrencySeen: 0,
    },
  };
}

/** 保存调度器状态到 localStorage */
export function saveSchedulerState(state: SchedulerState): boolean {
  try {
    const serialized = JSON.stringify({
      ...state,
      timestamp: Date.now(),
    });

    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(STORAGE_KEY, serialized);
    return true;
  } catch (error) {
    console.error('[SchedulerPersistence] Failed to save state:', error);
    return false;
  }
}

/** 从 localStorage 恢复调度器状态 */
export function loadSchedulerState(): SchedulerState | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const serialized = localStorage.getItem(STORAGE_KEY);
    if (!serialized) return null;

    const parsed = JSON.parse(serialized);

    // 版本检查
    if (parsed.version !== STORAGE_VERSION) {
      console.warn('[SchedulerPersistence] Version mismatch, clearing old state');
      clearSchedulerState();
      return null;
    }

    // 时间检查：超过24小时的状态视为过期
    const age = Date.now() - parsed.timestamp;
    if (age > 24 * 60 * 60 * 1000) {
      console.warn('[SchedulerPersistence] State expired (>24h), clearing');
      clearSchedulerState();
      return null;
    }

    // 数据完整性检查
    if (!parsed.activeRuns || !Array.isArray(parsed.activeRuns)) {
      console.error('[SchedulerPersistence] Invalid state structure');
      clearSchedulerState();
      return null;
    }

    return parsed as SchedulerState;
  } catch (error) {
    console.error('[SchedulerPersistence] Failed to load state:', error);
    clearSchedulerState();
    return null;
  }
}

/** 清除持久化状态 */
export function clearSchedulerState(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('[SchedulerPersistence] Failed to clear state:', error);
  }
}

/** 恢复运行中的任务（页面刷新后） */
export function recoverRunningTasks(state: SchedulerState, now: number): {
  recovered: TaskRun[];
  failed: TaskRun[];
  actions: string[];
} {
  const recovered: TaskRun[] = [];
  const failed: TaskRun[] = [];
  const actions: string[] = [];

  for (const run of state.activeRuns) {
    const elapsed = (now - run.startedAt) / 1000;

    // 检查是否超时（超过预计时间3倍）
    const estimatedDuration = run.plan.routes.reduce((sum, r) => Math.max(sum, r.estimatedSeconds), 0);
    const timeout = estimatedDuration * 3 + 300; // 额外5分钟缓冲

    if (elapsed > timeout) {
      // 超时任务标记为失败
      failed.push({
        ...run,
        status: 'failed',
        lifecycle: 'finished',
        outcome: 'failure',
        failureReason: `页面刷新后恢复失败: 任务超时 (${Math.round(elapsed)}s > ${timeout}s)`,
        endedAt: now,
      });
      actions.push(`任务 ${run.name} 标记为失败 (超时)`);
      continue;
    }

    // 恢复运行中的任务
    if (run.status === 'running' || run.status === 'paused') {
      recovered.push({
        ...run,
        // 恢复后从暂停状态开始，让用户手动恢复
        status: 'paused',
        pausedAt: now,
      });
      actions.push(`任务 ${run.name} 已恢复 (暂停状态)`);
      continue;
    }

    // 其他状态保持原样
    recovered.push(run);
  }

  return { recovered, failed, actions };
}

/** 清理过期的归档记录（保留最近100条） */
export function cleanupArchivedRuns(state: SchedulerState): SchedulerState {
  const MAX_ARCHIVED = 100;

  if (state.archivedRuns.length <= MAX_ARCHIVED) {
    return state;
  }

  // 按结束时间排序，保留最新的
  const sorted = [...state.archivedRuns].sort((a, b) => {
    const aEnd = a.endedAt || a.startedAt;
    const bEnd = b.endedAt || b.startedAt;
    return bEnd - aEnd;
  });

  return {
    ...state,
    archivedRuns: sorted.slice(0, MAX_ARCHIVED),
  };
}

/** 导出调度器状态为 JSON */
export function exportSchedulerState(state: SchedulerState): string {
  return JSON.stringify(state, null, 2);
}

/** 从 JSON 导入调度器状态 */
export function importSchedulerState(json: string): SchedulerState | null {
  try {
    const parsed = JSON.parse(json);

    // 基础验证
    if (!parsed.version || !parsed.activeRuns || !Array.isArray(parsed.activeRuns)) {
      throw new Error('Invalid state structure');
    }

    // 版本兼容性检查
    if (parsed.version !== STORAGE_VERSION) {
      throw new Error(`Version mismatch: expected ${STORAGE_VERSION}, got ${parsed.version}`);
    }

    return parsed as SchedulerState;
  } catch (error) {
    console.error('[SchedulerPersistence] Failed to import state:', error);
    return null;
  }
}

/** 创建状态快照（用于调试） */
export function createStateSnapshot(state: SchedulerState): {
  timestamp: number;
  summary: string;
  activeCount: number;
  queuedCount: number;
  archivedCount: number;
  leaseCount: number;
} {
  return {
    timestamp: Date.now(),
    summary: `${state.activeRuns.length} active, ${state.queuedRequests.length} queued, ${state.archivedRuns.length} archived`,
    activeCount: state.activeRuns.length,
    queuedCount: state.queuedRequests.length,
    archivedCount: state.archivedRuns.length,
    leaseCount: state.activeLeases.filter(l => l.status !== 'released').length,
  };
}
