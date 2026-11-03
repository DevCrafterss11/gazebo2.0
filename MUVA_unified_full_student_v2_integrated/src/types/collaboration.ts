import type { GpsAttackState } from './collaborationGps';
export type DroneStatus = 'WAITING' | 'READY' | 'RUNNING' | 'COMPLETE' | 'FAILED';
export type TaskStatus = 'WAITING' | 'RUNNING' | 'COMPLETE' | 'FAILED';
export type CollaborationMode = 'SYNC' | 'RELAY' | 'LEADER';
export type FailureType = 'DISCONNECT' | 'LOW_BATTERY';

export interface Position { x: number; y: number; z: number }
export interface TrajectorySample extends Position { timestamp?: number; gpsAttackId?: string }
export const taskTypeNames = ['区域巡逻', '目标搜索', '定点监测', '物资运输', '应急救援'] as const;
export type TaskType = typeof taskTypeNames[number];
export type InstanceStatus = 'STOPPED' | 'STARTING' | 'STANDBY' | 'FLYING' | 'RETURNING' | 'FAULT';
export type TaskLifecycle = '配置中' | '待确认' | '执行中' | '暂停' | '异常' | '待结果确认' | '安全收尾' | '已完成' | '已终止' | '已失败';
/** Teaching labels, not hardware discovery: type picks the seat family, payload picks the work it can do. */
export const droneTypeNames = ['侦察', '运输', '中继'] as const;
export type DroneType = typeof droneTypeNames[number];
export const dronePayloadNames = ['摄像头', '抛投器'] as const;
export type DronePayload = typeof dronePayloadNames[number];
export interface Drone {
  gpsAttack?: GpsAttackState;
  reportedPosition?: Position;
  id: string; name: string; droneType: DroneType; payload: DronePayload; endurance: number; speed: number; battery: number;
  /** ENU velocity in m/s, from the same sample as position (speed is cruise capability). */
  velocity: Position; position: Position; status: DroneStatus; taskGroupId: string; trajectory: TrajectorySample[];
  raspberryPiIp: string; mode: string; armed: boolean; attitude: [number, number, number];
  updatedAt: number; gazeboStatus: string; sitlStatus: string; mavlinkStatus: string;
  role: string; mapVisible: boolean; available: boolean;
  connectionStatus: 'DISCONNECTED' | 'CONNECTED' | 'STALE'; instanceStatus: InstanceStatus;
  visibleOnMap: boolean; assignedTaskId: string | null; currentRole: string;
  homePosition: Position; returnTrajectory: Position[]; flightControl?: FlightControl;

}
export interface Task { id: string; name: string; type: string; area: string; progress: number; status: TaskStatus; description: string; droneCount: number; color: string }
export interface TaskConfig { altitude: number; duration: number; strategy: string; routeSpacing: number; priority: string; cargo: string; coverage: number; searchRange: number; confirmation: string; handover: string; heading?: number; headingMode?: 'auto' | 'manual'; relayCycles?: number; scenario?: SimulationScenario; targetEast?: number; targetNorth?: number }
export interface TaskGroup {
  id: string; name: string; taskId: string; drones: string[]; mode: CollaborationMode;
  progress: number; status: TaskStatus; color: string; config: TaskConfig; points: MapPoint[];
  roles: Record<string, string>; lifecycle: TaskLifecycle; runId: string | null;
  startedAt: number | null; endedAt: number | null; elapsedTicks: number; dwellTicks?: number;
  areaClosed?: boolean; plan?: MissionPlan; execution?: TaskExecution; outcome?: 'success' | 'failure' | 'cancelled'; failureReason?: string;
}
export interface MapPoint extends Position { kind: 'point' | 'start' | 'delivery' }
export interface CommunicationNode { droneId: string; ip: string; network: '未连接' | '模拟在线' | '真实在线' | '中断'; mavlink: string; heartbeatAt: number | null; source: 'Mock' | 'SITL' | 'Raspberry Pi Relay' | 'Hardware' }
export interface ArrayLayout { centerX: number; centerY: number; columnSpacing: number; rowSpacing: number; altitude: number }
export interface TaskEvent { id: string; time: number; level: 'info' | 'warning' | 'success'; title: string; detail: string; groupId?: string; simulated: true }
export interface GroupEvaluation { groupId: string; status: TaskStatus; participants: string[]; metrics: { label: string; value: string }[]; trajectorySamples: number }
export interface EvaluationResult { status: string; completion: number; duration: number; droneCount: number; completedGroups: number; failedGroups: number; anomalyCount: number; groups: GroupEvaluation[] }
export interface MapReference { origin: [number, number]; axes: 'ENU' }
export interface Mission { dataSource: CommunicationNode['source']; mapReference: MapReference; tasks: Task[]; groups: TaskGroup[]; drones: Drone[] }
export interface CollaborationFailure { type: FailureType; droneId: string; title: string; impact: string; resolved: boolean }
export interface CollaborationScore { completion: number; duration: number; coordination: number; response: number; total: number }
export const collaborationModeLabels: Record<CollaborationMode, { label: string; description: string; suitable: string }> = {
  SYNC: { label: '同步执行', description: '多个无人机同时执行任务。', suitable: '适合区域搜索' },
  RELAY: { label: '接力执行', description: '无人机按顺序交接任务。', suitable: '适合长距离巡检' },
  LEADER: { label: '主辅协同', description: '主机规划，其他无人机辅助执行。', suitable: '适合目标跟踪' },
};

export interface TaskRecord {
  id: string; groupId: string; type: TaskType; name: string; startedAt: number; endedAt: number;
  dataSource: CommunicationNode['source']; mapReference: MapReference; group: TaskGroup; drones: Drone[]; events: TaskEvent[]; evaluation: EvaluationResult;
}

/** Experiment-three-only mission planning and deployment. No hardware command claims. */
export type SimulationScenario = 'success' | 'upload-failure' | 'execution-failure' | 'negative-result';
export interface AircraftRoute {
  droneId: string; role: string; waypoints: Position[]; workStart: number; length: number;
  estimatedSeconds: number; stationSeconds: number; order: number; dependsOn?: string;
}
export interface CoverageRegion { name: string; droneId: string; area: number; polygon: Position[] }
export interface DeploymentReceipt { droneId: string; accepted: boolean; detail: string }
export interface MissionPlan {
  id: string; fingerprint: string; createdAt: number; area: number; routes: AircraftRoute[];
  warnings: string[]; stage: 'planned' | 'uploaded' | 'armed'; receipts: DeploymentReceipt[];
  coverageHeading?: number; regions?: CoverageRegion[]; searchTarget?: Position;
}
export type AircraftPhase = 'queued' | 'takeoff' | 'transit' | 'working' | 'returning' | 'done' | 'failed';
export interface AircraftExecution {
  droneId: string; phase: AircraftPhase; waypoint: number; dwell: number; completed: boolean;
  launchedAt?: number; arrivedAt?: number;
  /** 定点监测：剩余监测时间（秒），仅在 working 阶段有效 */
  remainingStationSeconds?: number;
}
export interface TaskExecution {
  aircraft: AircraftExecution[]; seconds: number; reconConfirmed: boolean;
  awaiting: 'recon' | 'result' | null; targetFound: boolean; confirmedBy: string[];
  handovers: number; gapSeconds: number;
}

export type FlightMode = 'GUIDED' | 'LOITER' | 'STABILIZE' | 'AUTO' | 'RTL' | 'LAND';
export type FlightCommand =
  | { type: 'mode'; mode: FlightMode }
  | { type: 'arm' | 'disarm' | 'return' | 'land' | 'hold' }
  | { type: 'takeoff'; altitude: number }
  | { type: 'goto'; target: Position }
  | { type: 'move'; direction: 'forward' | 'back' | 'left' | 'right' | 'up' | 'down'; distance: number }
  | { type: 'yaw'; degrees: number }
  | { type: 'upload'; waypoints: Position[] };
export interface FlightControl {
  phase: 'ground' | 'takeoff' | 'hold' | 'goto' | 'route' | 'landing' | 'return';
  target: Position; route: Position[]; waypoint: number; heading: number; seconds: number;
}
export interface FlightCommandReceipt {
  id: string; droneId: string; command: FlightCommand; requestedAt: number;
  status: 'pending' | 'accepted' | 'rejected'; acknowledgedAt?: number; detail: string;
}
