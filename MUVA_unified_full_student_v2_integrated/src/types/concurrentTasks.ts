import type { Drone, DroneType, DronePayload, TaskGroup, TaskEvent, EvaluationResult, MissionPlan, TaskExecution, Position, TaskType } from './collaboration';

/** 任务运行实例：每个执行任务拥有独立的状态、时钟和事件流 */
export interface TaskRun {
  id: string; // run-{timestamp}-{sequence}
  groupId: string;
  taskType: TaskType;
  name: string;
  priority: number; // 1-10, 10最高

  // 运行时状态
  status: 'queued' | 'deploying' | 'running' | 'paused' | 'completing' | 'completed' | 'failed' | 'cancelled';
  lifecycle: 'pending' | 'armed' | 'airborne' | 'returning' | 'finished';

  // 租赁的资源
  leases: DroneLease[];

  // 规划与执行
  plan: MissionPlan;
  execution: TaskExecution;

  // 独立时钟
  startedAt: number;
  endedAt: number | null;
  elapsedSeconds: number;
  pausedAt: number | null;
  pausedDuration: number;

  // 独立事件流
  events: TaskEvent[];

  // 结果
  outcome: 'success' | 'failure' | 'cancelled' | null;
  failureReason: string | null;
  evaluation: EvaluationResult | null;

  // 空域分配（用于冲突检测）
  altitudeBand: [number, number]; // [min, max] 高度范围
  conflictChecksum: string; // 用于快速冲突检测
}

/** 无人机租赁：原子资源分配单位 */
export interface DroneLease {
  droneId: string;
  runId: string;
  taskType: TaskType;
  role: string;

  // 资格验证
  requiredType: DroneType;
  requiredPayload: DronePayload | null;

  // 租赁状态
  status: 'reserved' | 'armed' | 'flying' | 'returning' | 'released';
  acquiredAt: number;
  releasedAt: number | null;

  // 资源检查
  batteryAtAcquire: number;
  connectionAtAcquire: 'CONNECTED' | 'DISCONNECTED' | 'STALE';
}

/** 调度请求：提交给调度器的任务启动请求 */
export interface ScheduleRequest {
  groupId: string;
  taskType: TaskType;
  name: string;
  priority: number;
  drones: string[];
  roles: Record<string, string>;
  plan: MissionPlan;

  // 空域需求
  minAltitude: number;
  maxAltitude: number;

  // 调度选项
  allowPartialStart: boolean; // 是否允许部分飞机起飞（默认false）
  startDelay: number; // 延迟启动秒数（用于错峰）
}

/** 调度结果：调度器返回的决策 */
export interface ScheduleResult {
  accepted: boolean;
  runId: string | null;
  leases: DroneLease[];

  // 拒绝原因
  reason: string | null;
  conflicts: string[]; // 冲突描述列表

  // 调度建议
  suggestedDelay: number; // 建议延迟秒数
  unavailableDrones: string[]; // 不可用的飞机列表
}

/** 资源池状态快照 */
export interface ResourcePoolSnapshot {
  timestamp: number;
  totalDrones: number;
  availableDrones: string[];
  leasedDrones: { droneId: string; runId: string; role: string }[];
  runningTasks: number;
  queuedRequests: number;
}

/** 全局调度状态：持久化到 localStorage */
export interface SchedulerState {
  version: number; // 1
  timestamp: number;

  // 活动的任务运行实例
  activeRuns: TaskRun[];

  // 待处理的调度请求队列
  queuedRequests: ScheduleRequest[];

  // 已归档的运行记录
  archivedRuns: TaskRun[];

  // 全局租赁表
  activeLeases: DroneLease[];

  // 调度统计
  stats: {
    totalStarted: number;
    totalCompleted: number;
    totalFailed: number;
    totalCancelled: number;
    currentConcurrency: number;
    maxConcurrencySeen: number;
  };
}

/** 空域冲突检测结果 */
export interface AirspaceConflict {
  runId1: string;
  runId2: string;
  taskType1: TaskType;
  taskType2: TaskType;
  overlapAltitude: [number, number];
  severity: 'warning' | 'critical';
  recommendation: string;
}

/** 任务运行时钟更新 */
export interface TaskRunClockUpdate {
  runId: string;
  elapsedSeconds: number;
  pausedDuration: number;
  dronePositions: Record<string, Position>;
  dronePhases: Record<string, string>;
}
