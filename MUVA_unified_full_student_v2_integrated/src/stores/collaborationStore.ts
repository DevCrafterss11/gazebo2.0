import type { BasicAttackConfig } from '../domain/basicAttackConfig';
import { defaultPayload, isDronePayload, isDroneType, pickSeat, resourceCompatibility, seatRequirements, seatsFor } from '../domain/collaborationResources';
import { captureCollaborationPreferences, restoreCollaborationPreferences, saveCollaborationPreferences } from '../services/preferences/collaborationPreferences';
import { flightCommandLabel } from '../domain/collaborationFlight';
import { buildMissionPlan, initialTaskExecution, planFingerprint, validPlanningPolygon, insidePolygon } from '../domain/collaborationPlanning';
import { create } from 'zustand';
import { services } from '../services/serviceRegistry';
import { eligibility, minimumTaskDrones, taskRoles, validateTask } from '../domain/collaborationMission';
import type { ArrayLayout, CommunicationNode, CollaborationFailure, CollaborationMode, CollaborationScore, Drone, DronePayload, DroneType, EvaluationResult, FailureType, MapPoint, Mission, TaskConfig, TaskEvent, TaskGroup, TaskRecord, TaskType, FlightCommand, FlightCommandReceipt, MissionPlan } from '../types/collaboration';
import type { SchedulerState, TaskRun, ScheduleRequest } from '../types/concurrentTasks';
import * as scheduler from '../domain/taskScheduler';
import * as taskRuntime from '../domain/taskRuntime';
import { saveSchedulerState, loadSchedulerState, createInitialSchedulerState, clearSchedulerState } from '../services/schedulerPersistence';

const runtime = services.collaboration;
let sequence = 0;
const flightSessionKey = 'muva:collaboration:active-flight';
const sessionStorageSafe = () => { try { return typeof window === 'undefined' ? undefined : window.sessionStorage; } catch { return undefined; } };
const event = (title: string, detail: string, level: TaskEvent['level'] = 'info', groupId?: string): TaskEvent => ({ id: `event-${++sequence}`, time: Date.now(), title, detail, level, groupId, simulated: true });
const defaultLayout: ArrayLayout = { centerX: 0, centerY: 0, columnSpacing: 5, rowSpacing: 5, altitude: 0 };
const initial = () => {
  const restored = restoreCollaborationPreferences(runtime.createInitialMission(), { ...defaultLayout });
  const savedScheduler = loadSchedulerState();
  let interruptedFlight = false;
  try { interruptedFlight = sessionStorageSafe()?.getItem(flightSessionKey) === '1'; sessionStorageSafe()?.removeItem(flightSessionKey); } catch { /* storage unavailable */ }
  // The simulator and task records live only in this JS session. Restoring even archived
  // scheduler counters without their records (or active leases without live aircraft) would
  // produce a split-brain session. A full reload always starts a clean simulator session.
  if (savedScheduler) clearSchedulerState();
  return ({
  preferenceStatus: restored.status, arrayLayout: restored.layout, missionState: restored.mission,
  communicationNodes: Array.from({ length: 15 }, (_, i): CommunicationNode => ({ droneId: `uav${i + 101}`, ip: `192.168.10.${i + 101}`, network: '未连接', mavlink: '转发服务未接入', heartbeatAt: null, source: runtime.source })),
  businessView: 'global', currentStep: 0, selectedTaskGroup: 'group-1', selectedDrone: 'uav101' as string | null,
  score: { completion: 0, duration: 0, coordination: 0, response: 0, total: 0 } as CollaborationScore,
  failure: null as CollaborationFailure | null, isRunning: false, isPaused: false,
  runningTaskGroupIds: [] as string[], activeGroupId: null as string | null, elapsedSeconds: 0,
  simulationEnabled: false, clusterStarting: false, clusterRunning: false, clusterStopped: false, stopRequested: false, bootProgress: 0,
  mapPoints: [] as MapPoint[], events: [] as TaskEvent[], evaluation: null as EvaluationResult | null,
  planStartedAt: null as number | null, planEndedAt: null as number | null, lastCheckAt: Date.now(),
  records: [] as TaskRecord[], notice: interruptedFlight || savedScheduler?.activeRuns.length
    ? '页面重载开启了新的模拟会话；上次飞行无法恢复，旧租赁已清理，请重新启动集群并部署任务。'
    : savedScheduler?.archivedRuns.length ? '页面重载开启了新的模拟会话；上一会话的任务记录不跨刷新保存，旧调度统计已清理。' : '', flightCommands: [] as FlightCommandReceipt[],
  // 多任务调度状态
  schedulerState: createInitialSchedulerState(),
  concurrentMode: false, // 并发模式开关，暂时保留单任务兼容
});
};
interface CollaborationState extends ReturnType<typeof initial> {
  setBusinessView(view: string): void; setStep(step: number): void; selectTaskGroup(id: string): void; selectDrone(id: string | null): void;
  setArrayLayout(patch: Partial<ArrayLayout>): void; enterSimulation(): void; recheck(): void;
  startCluster(): void; stopCluster(): void;
  startGpsAttack(config: BasicAttackConfig): boolean; stopGpsAttack(droneIds?: string[]): void;
  editResource(id: string, patch: { visibleOnMap?: boolean }): void;
  /** Change a drone's type/payload. Drafts it no longer fits are updated; archived and running groups are left alone. */
  reconfigureDrone(id: string, loadout: { droneType: DroneType; payload: DronePayload }): boolean;
  assignDrone(id: string): void; setTaskDrone(groupId: string, id: string, selected: boolean): void; restoreDefaultPreferences(): void; setDroneRole(id: string, role: string): void; setTaskDroneRole(groupId: string, id: string, role: string): void; toggleMapVisibility(id: string): void;
  updateGroup(id: string, patch: Partial<TaskGroup>): void; updateGroupConfig(id: string, patch: Partial<TaskConfig>): void; setSearchTarget(point: { x: number; y: number }): boolean;
  addMapPoint(point: MapPoint): void; setRectangleArea(a: MapPoint, b: MapPoint): boolean; updateMapPoint(index: number, point: MapPoint): void; removeMapPoint(index: number): void; clearMapPoints(): void; clearTaskArea(): void;
  reorderTaskDrone(id: string, direction: -1 | 1): void; failExecution(reason?: string): void;
  closeTaskArea(): boolean; generateTaskPlan(): boolean; distributeTask(): boolean; armTask(): boolean; loadTaskExample(): void;
  prepareTask(): boolean; cancelTaskPreparation(groupId?: string): void; startExecution(): boolean; confirmTaskResult(accepted?: boolean): void; pauseExecution(): void; resumeExecution(): void; terminateExecution(): void;
  sendFlightCommand(id: string, command: FlightCommand): void;
  returnDrone(id: string): void; newTask(reuse?: boolean): void;
  startTaskExecution(id: string): void; stopTaskExecution(id: string): void; stopExecution(): void;
  setMode(mode: CollaborationMode): void; injectFailure(type: FailureType, droneId: string): void;
  resolveFailure(action: 'continue' | 'return' | 'end'): void; reset(): void;

  // 多任务并发调度方法
  toggleConcurrentMode(): void;
  submitTaskToScheduler(groupId: string): boolean;
  pauseTaskRun(runId: string): boolean;
  resumeTaskRun(runId: string): boolean;
  cancelTaskRun(runId: string, reason?: string): boolean;
  getActiveTaskRuns(): TaskRun[];
  getResourcePoolSnapshot(): import('../types/concurrentTasks').ResourcePoolSnapshot;
}
const returning = (d: Drone): Drone => d.position.z <= d.homePosition.z + .05
  ? { ...d, gpsAttack: undefined, reportedPosition: undefined, armed: false, velocity: {x:0,y:0,z:0}, flightControl: d.flightControl ? {...d.flightControl,phase:'ground'} : undefined, assignedTaskId: null, taskGroupId: '', currentRole: '', role: '', instanceStatus: 'STANDBY', status: 'READY', mode: '待命' }
  : { ...d, gpsAttack: undefined, reportedPosition: undefined, instanceStatus: 'RETURNING', mode: 'RTL', armed: true };
export const useCollaborationStore = create<CollaborationState>((set, get) => {
  const updateDraft = (fn: (g: TaskGroup) => TaskGroup, groupId = get().selectedTaskGroup) => set((s) => {
    const g = s.missionState.groups.find((item) => item.id === groupId);
    if (!g || s.isRunning && !s.concurrentMode || !['配置中', '待确认'].includes(g.lifecycle) || g.lifecycle === '已完成' || g.lifecycle === '已终止' || g.lifecycle === '已失败') return s;
    return { notice: '', missionState: { ...s.missionState, groups: s.missionState.groups.map((item) => item.id === g.id ? { ...fn(item), lifecycle: '配置中', plan: undefined, execution: undefined, outcome: undefined, failureReason: undefined } : item), drones: s.missionState.drones.map(d => d.assignedTaskId === g.plan?.id ? { ...d, armed: false, assignedTaskId: null, mode: '待命' } : d) } };
  });
  const completeStop = () => {
    const s = get();
    if (s.missionState.drones.some((d) => d.armed || d.instanceStatus === 'RETURNING')) return;
    runtime.stopCluster();
    set({ clusterRunning: false, clusterStarting: false, clusterStopped: true, stopRequested: false, bootProgress: 0,
      communicationNodes: s.communicationNodes.map((n) => ({ ...n, network: '未连接', heartbeatAt: null, mavlink: '转发服务未接入' })),
      missionState: { ...s.missionState, drones: s.missionState.drones.map((d) => ({ ...d, connectionStatus: 'DISCONNECTED', instanceStatus: 'STOPPED', status: 'WAITING', assignedTaskId: null, currentRole: '', taskGroupId: '', armed: false, gazeboStatus: '已停止', sitlStatus: '已停止', mavlinkStatus: '未连接' })) },
      events: [...s.events, event('模拟集群已停止', '所有无人机安全落地后停止模拟实例。', 'warning')] });
  };
  const finish = (groupId: string) => {
    const s = get();
    const g = s.missionState.groups.find((item) => item.id === groupId);
    // Allow finish when all task aircraft have released their assignedTaskId (even if still returning to home)
    if (!g || g.lifecycle !== '安全收尾' || s.missionState.drones.some((d) => d.assignedTaskId === g.runId)) return;
    const endedAt = Date.now();
    const finalGroup: TaskGroup = { ...g, lifecycle: g.status === 'COMPLETE' ? '已完成' : g.outcome === 'failure' ? '已失败' : '已终止', endedAt };
    const mission: Mission = { ...s.missionState, groups: s.missionState.groups.map((item) => item.id === g.id ? finalGroup : item) };
    const events = [...s.events, event('任务安全结束', `${g.name} · ${finalGroup.lifecycle}；${g.failureReason || '已完成返航落地，资源释放，集群继续运行。'}`, g.status === 'COMPLETE' ? 'success' : 'warning', g.id)];
    const archivedEvents = new Set(s.records.flatMap((r) => r.events.map((e) => e.id)));
    const currentEvents = events.filter((e) => !archivedEvents.has(e.id) && e.time >= (g.startedAt ?? 0) && e.groupId === g.id);
    const evaluation = runtime.evaluate({ ...mission, groups: mission.groups.map((item) => item.id === g.id ? item : { ...item, runId: null }) }, currentEvents, (g.elapsedTicks ?? 0) * .85, finalGroup.lifecycle);
    const record: TaskRecord = { dataSource: mission.dataSource, mapReference: structuredClone(mission.mapReference), id: g.runId!, groupId: g.id, type: mission.tasks.find((t) => t.id === g.taskId)!.type as TaskType, name: g.name, startedAt: g.startedAt!, endedAt, group: structuredClone(finalGroup), drones: structuredClone(mission.drones.filter((d) => g.drones.includes(d.id))), events: structuredClone(currentEvents), evaluation };
    const remaining = s.runningTaskGroupIds.filter(id => id !== g.id);
    const run = s.schedulerState.activeRuns.find(r => r.groupId === g.id);
    const schedulerState = run ? taskRuntime.completeTaskRun(run, g.outcome === 'success' ? 'success' : g.outcome === 'cancelled' ? 'cancelled' : 'failure', evaluation, g.failureReason ?? null, s.schedulerState, endedAt).state : s.schedulerState;
    set({ missionState: mission, isRunning: remaining.length > 0, isPaused: false, activeGroupId: remaining.includes(s.activeGroupId ?? '') ? s.activeGroupId : remaining[0] ?? null,
      runningTaskGroupIds: remaining, planEndedAt: endedAt, evaluation, events, records: [...s.records, record], schedulerState, notice: '任务结束，配置与轨迹已保存；集群仍在运行。' });
    if (run) saveSchedulerState(schedulerState);
  };
  const onUpdate = (mission: Mission) => {
    const s = get(); const before = s.missionState;
    const flightCommands = s.flightCommands.map(receipt => {
      if (receipt.status !== 'pending') return receipt;
      const result = runtime.command(mission, receipt.droneId, receipt.command);
      mission = result.mission;
      return { ...receipt, status: result.accepted ? 'accepted' as const : 'rejected' as const, acknowledgedAt: Date.now(), detail: result.detail };
    });
    const events = [...s.events];
    before.drones.forEach(d => {
      if (d.gpsAttack && !mission.drones.find(next => next.id === d.id)?.gpsAttack)
        events.push(event('GPS 欺骗结束', `${d.id}：到期、触发边界或任务退出，恢复正常定位`, 'info', d.gpsAttack.groupId));
    });
    flightCommands.forEach((r, i) => {
      if (s.flightCommands[i]?.status === 'pending' && r.status !== 'pending') events.push(event(`模拟指令${r.status === 'accepted' ? '回执' : '拒绝'}`, `${r.droneId} · ${flightCommandLabel(r.command)} · ${r.detail}`, r.status === 'accepted' ? 'success' : 'warning'));
    });
    mission.groups.forEach((g, i) => {
      const prev = before.groups[i]!;
      if (prev.lifecycle !== '待结果确认' && g.lifecycle === '待结果确认') events.push(event('等待模拟人工确认', g.execution?.awaiting === 'recon' ? `${g.name}侦察机已完成现场侦察，请通过模拟侦察确认，救援机才会起飞；中继机继续驻留。` : `${g.name}航线执行完成，请在任务工作区确认最终模拟结果，随后全部返航。`, 'info', g.id));
      if (i === 1 && (g.execution ? !prev.execution?.targetFound && g.execution.targetFound : prev.progress < 55 && g.progress >= 55)) events.push(event('模拟目标发现', '已按演练目标坐标、实际模拟位置及确认条件取得目标回执；非摄像头识别。', 'info', g.id));
      if (g.outcome === 'failure' && prev.outcome !== 'failure') events.push(event('任务执行失败', g.failureReason || '模拟任务未通过验收', 'warning', g.id));
      g.execution?.aircraft.forEach(a => {
        const p = prev.execution?.aircraft.find(p => p.droneId === a.droneId);
        if (a.launchedAt !== undefined && p?.launchedAt === undefined) events.push(event('模拟起飞', `${a.droneId} 按已下发航线起飞。`, 'info', g.id));
        if (a.arrivedAt !== undefined && p?.arrivedAt === undefined) events.push(event('到达任务位置', `${a.droneId} 到达；驻留计时从此刻开始。`, 'info', g.id));
      });
      if ((g.execution?.handovers ?? 0) > (prev.execution?.handovers ?? 0)) events.push(event('监测队列交接', `第 ${g.execution!.handovers} 次接力完成，原监测机开始返航。`, 'success', g.id));
      if (prev.status !== 'COMPLETE' && g.status === 'COMPLETE') events.push(event('任务航线完成', '任务进入安全收尾，参与无人机自动返航。', 'success', g.id));
    });
    mission.drones.forEach(d => {
      const prev = before.drones.find(p => p.id === d.id);
      if (!prev?.flightControl || !d.flightControl) return;
      const phase = d.flightControl.phase, previous = prev.flightControl.phase;
      if (phase === previous) return;
      if (phase === 'return' && prev.battery <= 20) events.push(event('模拟低电量自动返航', `${d.id} 电量低于保留阈值，模拟飞控自动执行 RTL。`, 'warning'));
      if (phase === 'hold' && previous === 'takeoff') events.push(event('模拟起飞到高', `${d.id} 已到达设定高度，进入悬停。`, 'success'));
      if (phase === 'hold' && previous === 'route') events.push(event('模拟航线执行完成', `${d.id} 已逐点完成下发航线，末点悬停；可继续指令或返航。`, 'success'));
      if (phase === 'ground' && previous === 'landing') events.push(event('模拟降落完成', `${d.id} 原地降落并自动锁定。`, 'success'));
    });
    mission.drones.forEach((d) => { if (before.drones.find((p) => p.id === d.id)?.instanceStatus === 'RETURNING' && d.instanceStatus === 'STANDBY') events.push(event('单机返航落地', `${d.id} 返回独立 Home 并解除解锁。`, 'success', before.drones.find((p) => p.id === d.id)?.taskGroupId)); });
    const schedulerState = { ...s.schedulerState, activeRuns: s.schedulerState.activeRuns.map(run => {
      const group = mission.groups.find(g => g.id === run.groupId);
      return group ? { ...run, execution: group.execution ?? run.execution, elapsedSeconds: (group.elapsedTicks ?? 0) * .85,
        lifecycle: group.lifecycle === '安全收尾' ? 'returning' as const : 'airborne' as const,
        status: group.lifecycle === '安全收尾' ? 'completing' as const : group.lifecycle === '暂停' ? 'paused' as const : 'running' as const } : run;
    }), timestamp: Date.now() };
    set({ missionState: mission, flightCommands, events, schedulerState, elapsedSeconds: s.isRunning && !s.isPaused ? Math.round((mission.groups.find((g) => g.id === s.activeGroupId)?.elapsedTicks ?? 0) * .85) : s.elapsedSeconds });
    for (const groupId of get().runningTaskGroupIds) finish(groupId);
    if (get().stopRequested && !get().isRunning) completeStop();
    if (!get().clusterRunning && !get().isRunning && !get().missionState.drones.some((d) => d.instanceStatus === 'RETURNING')) runtime.stop();
  };
  const ensureClock = () => runtime.start(() => get().missionState, onUpdate, () => get().isPaused);
  return {
    ...initial(),
    setBusinessView: (view) => { if (view !== 'global' && !get().missionState.groups.some((g) => g.id === view)) return; if (view !== 'global') get().selectTaskGroup(view); set({ businessView: view }); },
    setStep: (step) => set((s) => step >= 0 && step <= 5 && (step === 0 || step === 1 && s.simulationEnabled || step >= 2 && step <= 4 && s.clusterRunning || step === 5 && s.records.length > 0) ? { currentStep: step } : s),
    selectTaskGroup: (id) => set((s) => s.missionState.groups.some((g) => g.id === id) ? { selectedTaskGroup: id, activeGroupId: s.runningTaskGroupIds.includes(id) ? id : s.activeGroupId, mapPoints: s.missionState.groups.find((g) => g.id === id)!.points, notice: '' } : s),
    selectDrone: (id) => set({ selectedDrone: id }),
    setArrayLayout: (patch) => set((s) => {
      const l = { ...s.arrayLayout, ...patch };
      if (s.clusterRunning || s.clusterStarting || Object.values(l).some((v) => !Number.isFinite(v) || Math.abs(v) > 20000) || l.columnSpacing < 5 || l.rowSpacing < 5 || l.altitude < 0) return s;
      return { arrayLayout: l, missionState: { ...s.missionState, drones: s.missionState.drones.map((d, i) => { const position = { x: l.centerX + (i % 5 - 2) * l.columnSpacing, y: l.centerY + (1 - Math.floor(i / 5)) * l.rowSpacing, z: l.altitude }; return { ...d, position, homePosition: { ...position } }; }) } };
    }),
    enterSimulation: () => set((s) => ({ simulationEnabled: true, events: [...s.events, event('进入教学模拟', 'Mock 运行时；未连接真实飞控或树莓派。')] })),
    recheck: () => set({ lastCheckAt: Date.now() }),
    startCluster: () => {
      const s = get(); if (!s.simulationEnabled || s.clusterRunning || s.clusterStarting) return;
      set({ clusterStarting: true, clusterStopped: false, bootProgress: 0, missionState: { ...s.missionState, drones: s.missionState.drones.map((d) => ({ ...d, instanceStatus: 'STARTING' })) } });
      runtime.startCluster((progress) => set({ bootProgress: progress }), () => { set((current) => ({ clusterStarting: false, clusterRunning: true, bootProgress: 100,
        communicationNodes: current.communicationNodes.map((n) => ({ ...n, network: '模拟在线', mavlink: '模拟转发 / 心跳', heartbeatAt: Date.now() })),
        missionState: { ...current.missionState, drones: current.missionState.drones.map((d) => ({ ...d, connectionStatus: 'CONNECTED', instanceStatus: 'STANDBY', status: 'READY', armed: false, assignedTaskId: null, currentRole: '', role: '', taskGroupId: '', mode: '待命', gazeboStatus: '模拟就绪', sitlStatus: '模拟就绪', mavlinkStatus: '模拟心跳', updatedAt: Date.now() })) },
        events: [...current.events, event('集群进入待命', '15 个独立实例与通信节点就绪；没有任务分配，未解锁、未起飞。', 'success')] })); ensureClock(); },
      () => set((current) => ({ communicationNodes: current.communicationNodes.map((n) => n.network === '模拟在线' ? { ...n, heartbeatAt: Date.now() } : n), missionState: { ...current.missionState, drones: current.missionState.drones.map((d) => d.instanceStatus === 'FAULT' || d.mavlinkStatus === '模拟中断' ? d : { ...d, updatedAt: Date.now() }) } })));
    },
    startGpsAttack: (config) => {
      const s = get();
      try {
        const mission = runtime.startGpsAttack(s.missionState, config);
        const groups = mission.groups.filter(g => g.drones.some(id => config.targetDroneIds.includes(id)));
        set({ missionState: mission, notice: '', events: [...s.events, ...groups.map(g => event('GPS 欺骗启动', `${config.name} · ${g.drones.filter(id => config.targetDroneIds.includes(id)).join('、')} · 逐机参数`, 'warning', g.id))] });
        ensureClock(); return true;
      } catch (error) { set({ notice: error instanceof Error ? error.message : 'GPS 攻击启动失败' }); return false; }
    },
    stopGpsAttack: (ids) => {
      const s = get(), targets = s.missionState.drones.filter(d => d.gpsAttack && (!ids || ids.includes(d.id)));
      set({ missionState: runtime.stopGpsAttack(s.missionState, ids), events: [...s.events, ...targets.map(d => event('GPS 欺骗停止', `${d.id} 恢复正常定位，历史攻击航迹保留`, 'info', d.gpsAttack!.groupId))] });
    },
    stopCluster: () => {
      const s = get(); if (!s.clusterRunning && !s.clusterStarting) return;
      get().cancelTaskPreparation();
      set({ flightCommands: get().flightCommands.map(r => r.status === 'pending' ? { ...r, status: 'rejected', acknowledgedAt: Date.now(), detail: '集群停止，已取消待确认指令' } : r), stopRequested: true, notice: '已请求停止集群，等待参与无人机安全返航落地。' });
      for (const id of s.runningTaskGroupIds) { if (get().missionState.groups.find(g => g.id === id)?.lifecycle !== '安全收尾') { get().selectTaskGroup(id); get().terminateExecution(); } }
      if (get().missionState.drones.some((d) => d.armed)) { set((current) => ({ missionState: { ...current.missionState, drones: current.missionState.drones.map((d) => d.armed ? returning(d) : d) } })); ensureClock(); }
      else completeStop();
    },
    editResource: (id, patch) => set((s) => {
      // Whitelist: only map visibility is editable here. Type/payload go through reconfigureDrone.
      if (!s.missionState.drones.some(item => item.id === id) || typeof patch.visibleOnMap !== 'boolean') return s;
      return { notice: '', missionState: { ...s.missionState, drones: s.missionState.drones.map(item => item.id === id ? { ...item, visibleOnMap: patch.visibleOnMap!, mapVisible: patch.visibleOnMap! } : item) } };
    }),
    reconfigureDrone: (id, loadout) => {
      const s = get(), d = s.missionState.drones.find(item => item.id === id);
      if (!d) return false;
      if (!isDroneType(loadout.droneType) || !isDronePayload(loadout.payload)) { set({ notice: '不支持的无人机类型或载荷。' }); return false; }
      if (d.assignedTaskId || d.armed || s.isRunning && !s.concurrentMode) { set({ notice: '资源占用或飞行中，不能改装；请等待飞机落地。' }); return false; }
      if (d.droneType === loadout.droneType && d.payload === loadout.payload) return true;
      const after = { droneType: loadout.droneType, payload: loadout.payload };
      const types = s.missionState.tasks.map(t => t.type as TaskType);
      set({ notice: '', missionState: { ...s.missionState,
        drones: s.missionState.drones.map(item => item.id === id ? { ...item, ...after } : item),
        // Only open drafts change; archived groups keep their history untouched.
        groups: s.missionState.groups.map((g, gi) => {
          if (!g.drones.includes(id) || !['配置中', '待确认'].includes(g.lifecycle) || g.runId) return g;
          const type = types[gi]!;
          const seats = seatsFor(after, type);
          const keep = seats.some(seat => seat.role === g.roles[id]);
          if (keep) return { ...g, plan: undefined, execution: undefined, lifecycle: '配置中' as const };
          const drones = g.drones.filter(x => x !== id), roles = { ...g.roles };
          delete roles[id];
          if (seats.length) { roles[id] = seats[0]!.role; return { ...g, drones: g.drones, roles, plan: undefined, execution: undefined, lifecycle: '配置中' as const }; }
          return { ...g, drones, roles, plan: undefined, execution: undefined, lifecycle: '配置中' as const };
        }) } });
      return true;
    },
    assignDrone: (id) => { const s = get(), g = s.missionState.groups.find(g => g.id === s.selectedTaskGroup); if (g) get().setTaskDrone(g.id, id, !g.drones.includes(id)); },
    setTaskDrone: (groupId, id, selected) => {
      const s = get(), g = s.missionState.groups.find(g => g.id === groupId), d = s.missionState.drones.find(d => d.id === id);
      if (!g || !d || s.isRunning && !s.concurrentMode) return;
      if (selected === g.drones.includes(id)) return;
      if (selected) {
        const owner = s.concurrentMode && s.missionState.groups.find(other => other.id !== groupId && !other.runId && other.drones.includes(id));
        if (owner) { set({ notice: `${id} 已在${owner.name}草稿中；并发任务须使用独立编组，请先从该草稿移出。` }); return; }
        const type = s.missionState.tasks.find(t => t.id === g.taskId)!.type;
        const reason = resourceCompatibility(d, type as TaskType) || (s.concurrentMode && s.clusterRunning ? eligibility(d, type) : '');
        if (reason) { set({ notice: `${id}：${reason}` }); return; }
      }
      updateDraft(item => {
        const roles = { ...item.roles };
        const taskType = s.missionState.tasks[s.missionState.groups.indexOf(g)]!.type as TaskType;
        if (selected) roles[id] = pickSeat(d, taskType, item.drones.map(x => roles[x] ?? ''));
        else delete roles[id];
        const drones = selected ? [...item.drones, id] : item.drones.filter(x => x !== id);
        // When the primary seat empties, promote a member that actually fits it; never write a seat a drone cannot hold.
        const primary = seatRequirements[taskType].find(seat => seat.primary)!;
        if (drones.length && !drones.some(member => roles[member] === primary.role)) {
          const heir = drones.find(member => { const m = s.missionState.drones.find(x => x.id === member); return !!m && seatsFor(m, taskType).some(seat => seat.role === primary.role); });
          if (heir) roles[heir] = primary.role;
        }
        return { ...item, drones, roles };
      }, groupId);
    },
    restoreDefaultPreferences: () => {
      const s = get(); if (s.clusterRunning || s.clusterStarting || s.isRunning) return;
      const mission = runtime.createInitialMission();
      set({ arrayLayout: { ...defaultLayout }, missionState: { ...s.missionState, drones: mission.drones, groups: s.missionState.groups.map((g, i) => ({ ...g, drones: [], roles: {}, mode: mission.groups[i]!.mode, plan: undefined, execution: undefined })) } });
    },
    setDroneRole: (id, role) => get().setTaskDroneRole(get().selectedTaskGroup, id, role),
    setTaskDroneRole: (groupId, id, role) => { const index = get().missionState.groups.findIndex(g => g.id === groupId); if (index < 0 || !taskRoles[index]!.includes(role)) return; updateDraft(g => g.drones.includes(id) ? { ...g, roles: { ...g.roles, [id]: role } } : g, groupId); },
    toggleMapVisibility: (id) => { const d = get().missionState.drones.find((item) => item.id === id); if (d) get().editResource(id, { visibleOnMap: !d.visibleOnMap }); },
    updateGroup: (id, patch) => { if (get().selectedTaskGroup !== id) return; updateDraft((g) => ({ ...g, name: patch.name ?? g.name, mode: patch.mode ?? g.mode })); },
    updateGroupConfig: (id, patch) => { if (get().selectedTaskGroup !== id || Object.values(patch).some((v) => typeof v === 'number' && !Number.isFinite(v))) return; updateDraft((g) => ({ ...g, config: { ...g.config, ...patch } })); },
    setSearchTarget: (point) => {
      const g = get().missionState.groups.find(item => item.id === get().selectedTaskGroup);
      if (!g || g.taskId !== 'task-2' || get().isRunning || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
      const region = g.points.filter(p => p.kind === 'point');
      if (g.areaClosed && validPlanningPolygon(region) && !insidePolygon({ ...point, z: g.config.altitude }, region)) {
        set({ notice: '演练目标必须在已闭合的搜索范围内；请在区域内重新拾取。' }); return false;
      }
      updateDraft(item => ({ ...item, config: { ...item.config, targetEast: point.x, targetNorth: point.y } }));
      return true;
    },
    addMapPoint: (point) => updateDraft((g) => ({ ...g, areaClosed: point.kind === 'point' && g.taskId !== 'task-3' ? false : g.areaClosed, points: [...g.points.filter((p) => point.kind === 'point' ? g.taskId !== 'task-3' || p.kind !== 'point' : p.kind !== point.kind), point] })),
    setRectangleArea: (a, b) => {
      const g = get().missionState.groups.find(g => g.id === get().selectedTaskGroup);
      if (!g || !['task-1', 'task-2'].includes(g.taskId) || get().isRunning) return false;
      const points: MapPoint[] = [{ ...a, kind: 'point' }, { x: b.x, y: a.y, z: a.z, kind: 'point' }, { ...b, z: a.z, kind: 'point' }, { x: a.x, y: b.y, z: a.z, kind: 'point' }];
      if (!validPlanningPolygon(points)) { set({ notice: '矩形面积至少为 1 m²，且长宽必须大于 0；请重新选择对角点。' }); return false; }
      updateDraft(item => ({ ...item, points: [...item.points.filter(p => p.kind !== 'point'), ...points], areaClosed: true }));
      return get().missionState.groups.find(item => item.id === g.id)?.points !== g.points;
    },
    updateMapPoint: (index, point) => updateDraft((g) => ({ ...g, points: g.points.map((p, i) => i === index ? point : p) })),
    removeMapPoint: (index) => updateDraft((g) => ({ ...g, points: g.points.filter((_, i) => i !== index), areaClosed: false })),
    clearMapPoints: () => updateDraft((g) => ({ ...g, points: [], areaClosed: false })),
    clearTaskArea: () => {
      const g = get().missionState.groups.find(item => item.id === get().selectedTaskGroup);
      if (!g || !['task-1', 'task-2'].includes(g.taskId) || !g.points.some(p => p.kind === 'point')) return;
      updateDraft(item => ({ ...item, points: item.points.filter(p => p.kind !== 'point'), areaClosed: false }));
    },
    reorderTaskDrone: (id, direction) => updateDraft(g => {
      const ids = [...g.drones], from = ids.indexOf(id), to = from + direction;
      if (from < 0 || to < 0 || to >= ids.length) return g;
      [ids[from], ids[to]] = [ids[to]!, ids[from]!]; return { ...g, drones: ids };
    }),
    failExecution: (reason = '资源异常，任务无法继续') => {
      const s = get(), g = s.missionState.groups.find(g => g.id === s.activeGroupId);
      if (!g || g.lifecycle === '安全收尾') return;
      set({ isPaused: false, missionState: { ...s.missionState, groups: s.missionState.groups.map(item => item.id === g.id ? { ...item, outcome: 'failure', failureReason: reason, status: 'FAILED', lifecycle: '安全收尾' } : item), drones: s.missionState.drones.map(d => d.assignedTaskId === g.runId ? returning(d) : d) }, events: [...s.events, event('任务执行失败', reason, 'warning', g.id)] }); ensureClock();
    },
    closeTaskArea: () => {
      const g = get().missionState.groups.find(g => g.id === get().selectedTaskGroup)!;
      if (!validPlanningPolygon(g.points.filter(p => p.kind === 'point'))) { set({ notice: '区域不能闭合：至少 3 个有效顶点，不能重合、共线或自交。' }); return false; }
      updateDraft(g => ({ ...g, areaClosed: true })); return true;
    },
    generateTaskPlan: () => {
      const s = get(), g = s.missionState.groups.find(g => g.id === s.selectedTaskGroup)!;
      if ((s.isRunning && !s.concurrentMode) || !s.clusterRunning || !['配置中', '待确认'].includes(g.lifecycle)) { set({ notice: '请在集群待命、任务配置阶段生成航线。' }); return false; }
      const errors = validateTask(s.missionState, g);
      if (errors.length) { set({ notice: errors.join('；') }); return false; }
      try {
        const plan = buildMissionPlan(s.missionState, g);
        set({ notice: '规划完成：请在地图检查每架飞机的航线，再检查并部署。', missionState: { ...s.missionState,
          groups: s.missionState.groups.map(item => item.id === g.id ? { ...item, plan, lifecycle: '配置中' } : item),
          drones: s.missionState.drones.map(d => d.assignedTaskId === g.plan?.id ? { ...d, armed: false, assignedTaskId: null, mode: '待命' } : d) },
          events: [...s.events, event('航线规划完成', `${plan.routes.length} 架分机航线，${plan.routes.reduce((n, r) => n + r.waypoints.length, 0)} 个航点；方案 ${plan.id}。`, 'info', g.id)] }); return true;
      } catch (error) { set({ notice: error instanceof Error ? error.message : '规划失败' }); return false; }
    },
    loadTaskExample: () => {
      const s = get(), g = s.missionState.groups.find(g => g.id === s.selectedTaskGroup)!;
      if ((s.isRunning && !s.concurrentMode) || !s.clusterRunning || g.runId) { set({ notice: '请在待命且无执行记录的任务草稿中载入示例。' }); return; }
      const index = s.missionState.groups.indexOf(g), type = s.missionState.tasks[index]!.type as TaskType;
      // One drone per seat, in seat order, taking the first ready drone that fits it. Drone loadouts are never changed here.
      const picked: { drone: Drone; role: string }[] = [];
      for (const seat of seatRequirements[type]) {
        const drone = s.missionState.drones.find(d => (!eligibility(d, type) || d.assignedTaskId === g.plan?.id) && !picked.some(p => p.drone.id === d.id)
          && (!s.concurrentMode || !s.missionState.groups.some(other => other.id !== g.id && !other.runId && other.drones.includes(d.id)))
          && seatsFor(d, type).some(item => item.role === seat.role));
        if (drone) picked.push({ drone, role: seat.role });
      }
      const candidates = picked.map(p => p.drone);
      if (candidates.length !== seatRequirements[type].length) { set({ notice: `无法为${type}生成完整独立编组：合格飞机已被其他草稿预选或正在执行。请到无人机资源管理移出冲突编组，或等待返航后重试。` }); return; }
      get().cancelTaskPreparation(g.id);
      const markers: MapPoint[] = (index === 2 ? [[35, 20]] : index < 2 ? [[-45, -30], [50, -30], [45, 38], [-40, 38]] : [[0, 10]]).map(([x, y]) => ({ x: x!, y: y!, z: 18, kind: 'point' }));
      if (index >= 3) markers.push({ x: -25, y: -15, z: 18, kind: 'start' }, { x: 55, y: 30, z: 18, kind: 'delivery' });
      updateDraft(item => ({ ...item, name: `${type}模拟演练`, points: markers, areaClosed: index < 2, drones: candidates.map(d => d.id),
        roles: Object.fromEntries(picked.map(p => [p.drone.id, p.role])),
        config: { ...item.config, altitude: 18, duration: 8, routeSpacing: 12, scenario: 'success', targetEast: undefined, targetNorth: undefined,
          strategy: ['区域覆盖', '网格搜索', '轮换监测', '定点交付', '先侦察后救援'][index]!, handover: '重叠监测', confirmation: index === 1 ? '人工复核' : index === 3 ? '人工签收' : item.config.confirmation } }));
      set({ notice: '已显式载入模拟坐标、参与飞机与角色；尚未规划、下发或起飞。' });
    },
    prepareTask: () => {
      const s = get(), g = s.missionState.groups.find(g => g.id === s.selectedTaskGroup)!;
      const errors = validateTask(s.missionState, g);
      const shared = s.concurrentMode && g.drones.find(id => s.missionState.groups.some(other => other.id !== g.id && !other.runId && other.drones.includes(id)));
      if (shared) { set({ notice: `${shared} 同时属于其他任务草稿；请在资源管理中为并发任务分配独立飞机。` }); return false; }
      if (!s.concurrentMode && s.missionState.groups.some(item => item.id !== g.id && item.lifecycle === '待确认')) { set({ notice: '另一个任务正在部署，请先取消其部署。' }); return false; }
      if (!s.clusterRunning || s.stopRequested || s.isRunning && !s.concurrentMode || !['配置中', '待确认'].includes(g.lifecycle) || errors.length) { set({ notice: errors.join('；') || '请确保集群待命、无其他执行任务，且当前任务处于配置阶段。' }); return false; }
      if (!g.plan || g.plan.fingerprint !== planFingerprint(s.missionState, g)) { set({ notice: '请先生成并检查当前方案的分机航线。' }); return false; }
      set({ notice: '', missionState: { ...s.missionState, groups: s.missionState.groups.map(item => item.id === g.id ? { ...item, lifecycle: '待确认' } : item) } }); return true;
    },
    distributeTask: () => {
      const s = get(), g = s.missionState.groups.find(g => g.id === s.selectedTaskGroup)!;
      if (!s.clusterRunning || s.stopRequested || s.isRunning && !s.concurrentMode || g.lifecycle !== '待确认' || !g.plan || g.plan.stage === 'armed' || g.plan.fingerprint !== planFingerprint(s.missionState, g)) return false;
      const errors = validateTask(s.missionState, g);
      if (errors.length) { set({ notice: errors.join('；') }); return false; }
      const receipts = runtime.deploy(s.missionState, g, 'upload'), accepted = receipts.length === g.drones.length && receipts.every(r => r.accepted);
      set({ missionState: { ...s.missionState, groups: s.missionState.groups.map(item => item.id === g.id ? { ...item, plan: { ...g.plan!, stage: accepted ? 'uploaded' : 'planned', receipts } } : item),
        drones: s.missionState.drones.map(d => accepted && g.drones.includes(d.id) ? { ...d, assignedTaskId: g.plan!.id, flightControl: undefined } : d) },
        notice: accepted ? '模拟航线下发完成，资源已锁定；尚未解锁或起飞。' : '模拟下发失败：没有飞机起飞，请查看逐机回执。',
        events: [...s.events, event(accepted ? '模拟航线下发成功' : '模拟航线下发失败', receipts.map(r => `${r.droneId}：${r.detail}`).join('；'), accepted ? 'success' : 'warning', g.id)] }); return accepted;
    },
    armTask: () => {
      const s = get(), g = s.missionState.groups.find(g => g.id === s.selectedTaskGroup)!;
      if (!s.clusterRunning || s.stopRequested || s.isRunning && !s.concurrentMode || g.lifecycle !== '待确认' || g.plan?.stage !== 'uploaded') return false;
      const receipts = runtime.deploy(s.missionState, g, 'arm');
      if (receipts.some(r => !r.accepted) || g.plan.fingerprint !== planFingerprint(s.missionState, g) || validateTask(s.missionState, g).length) { set({ notice: '模拟解锁失败，请取消部署并重新检查资源。' }); return false; }
      set({ missionState: { ...s.missionState, groups: s.missionState.groups.map(item => item.id === g.id ? { ...item, plan: { ...g.plan!, stage: 'armed' } } : item), drones: s.missionState.drones.map(d => g.drones.includes(d.id) ? { ...d, armed: true, mode: '模拟已解锁 / 地面' } : d) }, notice: '模拟解锁完成；仍在地面，需明确确认起飞。', events: [...s.events, event('模拟解锁确认', '参与飞机通过解锁检查；接力及依赖队列在执行开始后保持地面待命，轮到时再模拟解锁起飞。', 'info', g.id)] }); return true;
    },
    cancelTaskPreparation: (groupId) => set(s => {
      const targets = s.missionState.groups.filter(g => g.lifecycle === '待确认' && (!groupId || g.id === groupId));
      const ids = targets.map(g => g.plan?.id);
      return { notice: '', missionState: { ...s.missionState,
        groups: s.missionState.groups.map(g => targets.some(target => target.id === g.id) ? { ...g, lifecycle: '配置中', plan: g.plan ? { ...g.plan, stage: 'planned', receipts: [] } : undefined } : g),
        drones: s.missionState.drones.map(d => d.assignedTaskId && ids.includes(d.assignedTaskId) ? { ...d, armed: false, assignedTaskId: null, mode: '待命' } : d) } };
    }),
    startExecution: () => {
      const s = get(), g = s.missionState.groups.find(g => g.id === s.selectedTaskGroup)!;
      const errors = validateTask(s.missionState, g);
      if (!s.clusterRunning || s.stopRequested || s.isRunning && !s.concurrentMode || g.lifecycle !== '待确认' || g.plan?.stage !== 'armed' || g.drones.some(id => { const d = s.missionState.drones.find(d => d.id === id); return !d?.armed || d.assignedTaskId !== g.plan?.id; }) || errors.length || g.plan.fingerprint !== planFingerprint(s.missionState, g)) { set({ notice: errors.join('；') || '必须完成当前方案的检查、下发和模拟解锁，才能确认起飞。' }); return false; }
      const runId = s.concurrentMode ? s.schedulerState.activeRuns.find(r => r.groupId === g.id)?.id : undefined;
      if (s.concurrentMode && !runId) { set({ notice: '请先通过调度器提交任务' }); return false; }
      const actualRunId = runId ?? `run-${Date.now()}-${++sequence}`, startedAt = Date.now();
      const index = s.missionState.groups.indexOf(g);
      set({ isRunning: true, isPaused: false, activeGroupId: g.id, runningTaskGroupIds: [...s.runningTaskGroupIds, g.id], elapsedSeconds: 0, planStartedAt: startedAt, planEndedAt: null, evaluation: null, failure: null, notice: '',
        missionState: { ...s.missionState, groups: s.missionState.groups.map(item => item.id === g.id ? { ...item, execution: initialTaskExecution(g), outcome: undefined, failureReason: undefined, lifecycle: '执行中', status: 'RUNNING', progress: 0, elapsedTicks: 0, dwellTicks: 0, runId: actualRunId, startedAt, endedAt: null } : item),
          drones: s.missionState.drones.map(d => {
            if (!g.drones.includes(d.id)) return d;
            const queued = index === 2 && g.drones[0] !== d.id || !!g.plan!.routes.find(r => r.droneId === d.id)?.dependsOn;
            return { ...d, gpsAttack: undefined, reportedPosition: undefined, status: 'RUNNING', instanceStatus: queued ? 'STANDBY' : 'FLYING', assignedTaskId: actualRunId, taskGroupId: g.id, currentRole: g.roles[d.id]!, role: g.roles[d.id]!, mode: queued ? '接力 / 依赖待命' : 'TAKEOFF', armed: !queued, trajectory: [{ ...d.position, timestamp: Date.now() }], returnTrajectory: [] };
          }) }, events: [...s.events, event('独立任务开始', `${g.name} · 按方案 ${g.plan.id} 执行。`, 'info', g.id)] }); ensureClock(); return true;
    },
    confirmTaskResult: (accepted = true) => {
      const s = get(), g = s.missionState.groups.find(g => g.id === s.activeGroupId);
      if (!s.isRunning || !g || g.lifecycle !== '待结果确认') return;
      if (accepted && g.execution?.awaiting === 'recon' && g.config.scenario !== 'negative-result') {
        set({ isPaused: false, missionState: { ...s.missionState, groups: s.missionState.groups.map(item => item.id === g.id ? { ...item, lifecycle: '执行中', execution: { ...g.execution!, reconConfirmed: true, awaiting: null } } : item) }, events: [...s.events, event('模拟侦察确认', '人工确认演练现场，允许后续救援队列按依赖起飞。', 'success', g.id)] }); return;
      }
      const success = accepted && g.config.scenario !== 'negative-result';
      const reason = success ? '' : g.execution?.awaiting === 'recon' ? '人工未通过模拟现场侦察确认' : '模拟任务结果未通过人工验收 / 交付被拒绝';
      set({ isPaused: false, missionState: { ...s.missionState, groups: s.missionState.groups.map(item => item.id === g.id ? { ...item, outcome: success ? 'success' : 'failure', failureReason: reason, status: success ? 'COMPLETE' : 'FAILED', lifecycle: '安全收尾', execution: item.execution ? { ...item.execution, awaiting: null } : undefined } : item), drones: s.missionState.drones.map(d => d.assignedTaskId === g.runId ? returning(d) : d) }, events: [...s.events, event(success ? '模拟人工结果确认' : '模拟人工验收失败', success ? '模拟结果通过人工确认，参与机开始安全返航。' : reason, success ? 'success' : 'warning', g.id)] }); ensureClock();
    },
    pauseExecution: () => {
      const s = get(), group = s.missionState.groups.find(g => g.id === s.activeGroupId);
      if (!s.isRunning || !group || group.lifecycle !== '执行中') return;
      const now = Date.now();
      set({ isPaused: !s.concurrentMode,
        schedulerState: { ...s.schedulerState, activeRuns: s.schedulerState.activeRuns.map(run => run.groupId === group.id && run.status === 'running' ? taskRuntime.pauseTaskRun(run, now) : run) },
        missionState: { ...s.missionState,
          drones: s.missionState.drones.map(d => d.instanceStatus === 'FLYING' && d.assignedTaskId === group.runId ? { ...d, velocity: { x: 0, y: 0, z: 0 }, mode: 'LOITER', attitude: [0, 0, d.attitude[2]] as Drone['attitude'] } : d),
          groups: s.missionState.groups.map(g => g.id === group.id ? { ...g, lifecycle: '暂停' } : g) },
        events: [...s.events, event('任务暂停', '任务航线暂停推进，单机返航不受影响。', 'info', group.id)] });
    },
    resumeExecution: () => {
      const s = get(), group = s.missionState.groups.find(g => g.id === s.activeGroupId);
      if (!s.isRunning || !group) return;
      if (group.lifecycle === '异常') { set({ notice: '请先处置异常，或终止任务并安全返航。' }); return; }
      if (group.lifecycle !== '暂停') return;
      const now = Date.now();
      set({ isPaused: false,
        schedulerState: { ...s.schedulerState, activeRuns: s.schedulerState.activeRuns.map(run => run.groupId === group.id ? taskRuntime.resumeTaskRun(run, now) : run) },
        missionState: { ...s.missionState, groups: s.missionState.groups.map(g => g.id === group.id ? { ...g, lifecycle: '执行中' } : g) },
        events: [...s.events, event('任务继续', '当前任务恢复推进。', 'info', group.id)] });
    },
    terminateExecution: () => {
      const s = get(), group = s.missionState.groups.find(g => g.id === s.activeGroupId);
      if (!s.isRunning || !group || group.lifecycle === '安全收尾') return;
      const anyReturning = s.missionState.drones.some(d => d.assignedTaskId === group.runId && (d.armed || d.instanceStatus === 'RETURNING'));
      const now = Date.now();
      set({ isPaused: false,
        schedulerState: { ...s.schedulerState, activeRuns: s.schedulerState.activeRuns.map(run => run.groupId === group.id ? { ...taskRuntime.cancelTaskRun(run, '操作员主动结束任务', s.schedulerState, now).run, status: 'completing' } : run) },
        missionState: { ...s.missionState, groups: s.missionState.groups.map(g => g.id === group.id ? { ...g, status: 'FAILED', lifecycle: '安全收尾', outcome: 'cancelled', failureReason: '操作员主动结束任务' } : g), drones: s.missionState.drones.map(d => d.assignedTaskId === group.runId ? returning(d) : d) },
        events: [...s.events, event('任务终止', anyReturning ? '停止任务推进；等待全部参与机返航落地后释放资源。' : '任务已终止，参与机已落地，立即释放资源。', 'warning', group.id)] });
      if (!get().missionState.drones.some(d => d.assignedTaskId === group.runId)) finish(group.id);
      if (get().isRunning) ensureClock();
    },
    sendFlightCommand: (id, command) => {
      const s = get();
      if (!s.clusterRunning || s.stopRequested) { set({ notice: '请先启动模拟集群，停止过程中不接收新指令。' }); return; }
      if (s.flightCommands.some(r => r.droneId === id && r.status === 'pending')) { set({ notice: '该机上一条指令正在等待回执。' }); return; }
      const receipt: FlightCommandReceipt = { id: `command-${++sequence}`, droneId: id, command: structuredClone(command), requestedAt: Date.now(), status: 'pending', detail: '等待模拟飞控确认' };
      set({ flightCommands: [...s.flightCommands.slice(-99), receipt], notice: '' }); ensureClock();
    },
    returnDrone: (id) => {
      const s = get(); const d = s.missionState.drones.find((item) => item.id === id);
      if (!d || !d.armed || d.instanceStatus === 'RETURNING') { set({ notice: '此无人机已在地面或正在返航。' }); return; }
      if (d.flightControl && !d.assignedTaskId) { get().sendFlightCommand(id, { type: 'return' }); return; }
      const g = s.missionState.groups.find((item) => item.runId === d.assignedTaskId);
      const remaining = s.missionState.drones.filter((item) => item.assignedTaskId === d.assignedTaskId && item.id !== id && item.instanceStatus === 'FLYING');
      const type = s.missionState.tasks.find((t) => t.id === g?.taskId)?.type ?? '';
      const degraded = !!g?.plan && !g.execution?.aircraft.find(a => a.droneId === id)?.completed || (!!g && remaining.length < minimumTaskDrones(type, g)) || ['领航机', '运输机', '救援机', '监测机', '搜索机'].includes(d.currentRole);
      set({ missionState: { ...s.missionState, drones: s.missionState.drones.map((item) => item.id === id ? returning(item) : item), groups: s.missionState.groups.map((item) => g?.id === item.id && degraded && item.lifecycle !== '安全收尾' ? { ...item, lifecycle: '异常' } : item) }, notice: degraded ? '关键角色返航或剩余资源不足，任务进入待处置状态；不会自动终止。' : '单机返航中，其他无人机继续任务。', events: [...s.events, event(degraded ? '任务资源退出告警' : '单机返航请求', `${id} 沿独立返航路线返回 Home；${degraded ? '任务降级，需要处置' : '其他成员继续执行'}。`, 'warning', g?.id)] }); ensureClock();
    },
    newTask: (reuse = false) => { const s = get(); if (s.isRunning && !s.concurrentMode) { set({ notice: '请等待当前任务安全结束。' }); return; } const g = s.missionState.groups.find((item) => item.id === s.selectedTaskGroup)!; if (g.runId && !['已完成', '已失败', '已终止'].includes(g.lifecycle)) { set({ notice: '当前任务仍在运行或返航，不能覆盖。' }); return; } set({ notice: '', missionState: { ...s.missionState, groups: s.missionState.groups.map((item) => item.id === g.id ? { ...item, name: reuse ? item.name : `${s.missionState.tasks.find((t) => t.id === g.taskId)!.type}任务`, drones: item.drones, roles: item.roles, points: reuse ? item.points : [], status: 'WAITING', lifecycle: '配置中', progress: 0, elapsedTicks: 0, dwellTicks: 0, runId: null, startedAt: null, endedAt: null, plan: undefined, execution: undefined, outcome: undefined, failureReason: undefined, areaClosed: reuse ? item.areaClosed : false } : item), drones: s.missionState.drones.map(d => d.assignedTaskId === g.plan?.id ? { ...d, armed: false, assignedTaskId: null, mode: '待命' } : d) } }); },
    startTaskExecution: (id) => { get().selectTaskGroup(id); set({ notice: '请通过任务摘要明确确认开始。' }); },
    stopTaskExecution: () => get().pauseExecution(), stopExecution: () => get().terminateExecution(),
    setMode: (mode) => get().updateGroup(get().selectedTaskGroup, { mode }),
    injectFailure: (type, id) => { const s = get(); const d = s.missionState.drones.find((item) => item.id === id); if (!s.isRunning || !d?.assignedTaskId || d.instanceStatus !== 'FLYING') return; const affectedGroup = s.missionState.groups.find(g => g.runId === d.assignedTaskId); if (!affectedGroup) return; set({ failure: { type, droneId: id, title: type === 'LOW_BATTERY' ? '模拟低电量' : '模拟通信中断', impact: '单机退出；检查剩余资源和角色。', resolved: false }, missionState: { ...s.missionState, drones: s.missionState.drones.map((item) => item.id === id ? { ...item, connectionStatus: type === 'DISCONNECT' ? 'DISCONNECTED' : item.connectionStatus, battery: type === 'LOW_BATTERY' ? 15 : item.battery, mavlinkStatus: type === 'DISCONNECT' ? '模拟中断' : item.mavlinkStatus } : item) }, communicationNodes: s.communicationNodes.map((n) => n.droneId === id && type === 'DISCONNECT' ? { ...n, network: '中断', heartbeatAt: null, mavlink: '模拟转发中断' } : n), events: [...s.events, event(type === 'LOW_BATTERY' ? '模拟低电量告警' : '模拟通信中断', `${id} 模拟自动安全返航。`, 'warning', affectedGroup.id)] }); get().returnDrone(id); },
    resolveFailure: (action) => { const s = get(); if (action === 'end' || action === 'return') { get().terminateExecution(); return; } const g = s.missionState.groups.find((item) => item.id === s.activeGroupId); if (!g || g.lifecycle !== '异常') return; if (g.plan) { set({ notice: '分机规划中仍有未执行航段，不能只更换角色就忽略覆盖缺口。请确认失败并返航，再重新编组规划。' }); return; } const remaining = s.missionState.drones.filter((d) => d.assignedTaskId === g.runId && d.instanceStatus === 'FLYING'); const required = minimumTaskDrones(s.missionState.tasks.find((t) => t.id === g.taskId)!.type, g); if (remaining.length < required) { set({ notice: `当前任务至少需要 ${required} 架在飞机，剩余 ${remaining.length} 架；请终止任务并重新编组。` }); return; } const replacement = remaining[0]!; const role = taskRoles[s.missionState.groups.indexOf(g)]![0]!; set({ isPaused: false, failure: s.failure ? { ...s.failure, resolved: true } : null, missionState: { ...s.missionState, groups: s.missionState.groups.map((item) => item.id === g.id ? { ...item, lifecycle: '执行中', roles: { ...item.roles, [replacement.id]: role } } : item), drones: s.missionState.drones.map((d) => d.id === replacement.id ? { ...d, currentRole: role, role } : d) }, notice: `已确认降级，由 ${replacement.id} 接替 ${role}。`, events: [...s.events, event('异常降级处置', `${replacement.id} 接替 ${role}，以剩余成员继续任务。`, 'warning', g.id)] }); },

    // ============ 多任务并发调度方法 ============
    toggleConcurrentMode: () => {
      const s = get();
      if (s.isRunning || s.schedulerState.activeRuns.length) { set({ notice: '请等待所有任务安全返航后切换模式' }); return; }
      set({ concurrentMode: !s.concurrentMode, notice: s.concurrentMode ? '已切换为单任务模式' : '已启用多任务并发模拟：草稿编组互斥，不提供真实空域避碰' });
    },

    submitTaskToScheduler: (groupId) => {
      const s = get();
      const group = s.missionState.groups.find(item => item.id === groupId);
      if (!s.concurrentMode || !s.clusterRunning || !group || group.id !== s.selectedTaskGroup || group.lifecycle !== '待确认' || group.plan?.stage !== 'armed'
        || s.schedulerState.activeRuns.some(r => r.groupId === groupId)) { set({ notice: '请先完成当前任务的检查、下发和解锁，且不要重复提交。' }); return false; }
      if (validateTask(s.missionState, group).length || group.plan.fingerprint !== planFingerprint(s.missionState, group)) { set({ notice: '资源或方案已变更，请取消部署并重新规划。' }); return false; }
      // Mock has no certified separation/trajectory deconfliction. Do not silently rewrite an
      // already-uploaded route or reject an otherwise independent group on a global altitude band.
      const candidate = group;
      const mission = s.missionState;
      const altitudes = candidate.plan!.routes.flatMap(r => r.waypoints.map(p => p.z));
      const type = s.missionState.tasks.find(t => t.id === group.taskId)!.type as TaskType;
      const request: ScheduleRequest = { groupId, taskType: type, name: group.name, priority: group.config.priority === '紧急' ? 10 : group.config.priority === '高' ? 7 : 5,
        drones: group.drones, roles: group.roles, plan: candidate.plan!, minAltitude: Math.min(...altitudes), maxAltitude: Math.max(...altitudes), allowPartialStart: false, startDelay: 0 };
      const decision = scheduler.scheduleTask(request, mission.drones.map(d => d.assignedTaskId === group.plan!.id ? { ...d, assignedTaskId: null, armed: false } : d), s.schedulerState, Date.now());
      if (!decision.accepted || !decision.runId) { set({ notice: `调度失败：${decision.reason ?? decision.conflicts.join('；')} ${decision.unavailableDrones.join('；')}` }); return false; }
      const run: TaskRun = { ...taskRuntime.createTaskRun(decision.runId, candidate, decision.leases, Date.now()), taskType: type, status: 'running', lifecycle: 'armed' };
      const leases = decision.leases.map(l => ({ ...l, runId: decision.runId! }));
      const schedulerState: SchedulerState = { ...s.schedulerState, activeRuns: [...s.schedulerState.activeRuns, run], activeLeases: [...s.schedulerState.activeLeases, ...leases],
        stats: { ...s.schedulerState.stats, totalStarted: s.schedulerState.stats.totalStarted + 1, currentConcurrency: s.schedulerState.activeRuns.length + 1,
          maxConcurrencySeen: Math.max(s.schedulerState.stats.maxConcurrencySeen, s.schedulerState.activeRuns.length + 1) } };
      set({ missionState: mission, schedulerState });
      if (!get().startExecution()) { set({ missionState: s.missionState, schedulerState: s.schedulerState }); return false; }
      saveSchedulerState(schedulerState);
      set({ notice: `已调度 ${group.name}；${decision.suggestedDelay ? `已立即模拟起飞；建议下次人工错峰 ${decision.suggestedDelay.toFixed(0)} 秒（不自动排队）` : '已起飞'}` });
      return true;
    },

    pauseTaskRun: (runId) => {
      const run = get().schedulerState.activeRuns.find(r => r.id === runId);
      if (!run || run.status !== 'running' || get().missionState.groups.find(g => g.id === run.groupId)?.lifecycle !== '执行中') return false;
      get().selectTaskGroup(run.groupId);
      get().pauseExecution();
      return true;
    },
    resumeTaskRun: (runId) => {
      const run = get().schedulerState.activeRuns.find(r => r.id === runId);
      if (!run || run.status !== 'paused' || get().missionState.groups.find(g => g.id === run.groupId)?.lifecycle !== '暂停') return false;
      get().selectTaskGroup(run.groupId);
      get().resumeExecution();
      return true;
    },
    cancelTaskRun: (runId, reason = '用户取消') => {
      const run = get().schedulerState.activeRuns.find(r => r.id === runId);
      if (!run || !['running', 'paused'].includes(run.status)) return false;
      get().selectTaskGroup(run.groupId);
      get().terminateExecution();
      set({ notice: `${run.name}：${reason}；等待参与飞机返航后释放资源。` });
      return true;
    },

    getActiveTaskRuns: () => {
      return get().schedulerState.activeRuns.filter(r => r.status === 'running' || r.status === 'paused' || r.status === 'deploying' || r.status === 'completing');
    },

    getResourcePoolSnapshot: () => {
      const s = get();
      return scheduler.getResourcePoolSnapshot(s.missionState.drones, s.schedulerState, Date.now());
    },

    reset: () => { runtime.stopCluster(); clearSchedulerState(); set(initial()); },
  };
});

// Serialize only preference changes: the runtime's high-frequency telemetry never writes storage.
let previousPreferences = JSON.stringify(captureCollaborationPreferences(useCollaborationStore.getState().missionState, useCollaborationStore.getState().arrayLayout));
let previousActiveFlight = false;
// A v1 save (or a repaired v2 save) is written back as v2 once at startup. Without this the baseline above equals the
// restored state, so no change would ever trigger a save and the old key would be read again on every load.
if (/迁移|不再适配/.test(useCollaborationStore.getState().preferenceStatus)) saveCollaborationPreferences(JSON.parse(previousPreferences) as ReturnType<typeof captureCollaborationPreferences>);
useCollaborationStore.subscribe(state => {
  const activeFlight = state.isRunning || state.schedulerState.activeRuns.length > 0
    || state.missionState.drones.some(d => d.armed || d.instanceStatus === 'RETURNING');
  if (activeFlight !== previousActiveFlight) {
    previousActiveFlight = activeFlight;
    try { if (activeFlight) sessionStorageSafe()?.setItem(flightSessionKey, '1'); else sessionStorageSafe()?.removeItem(flightSessionKey); } catch { /* private browsing */ }
  }
  const preferences = captureCollaborationPreferences(state.missionState, state.arrayLayout);
  const serialized = JSON.stringify(preferences);
  if (serialized === previousPreferences) return;
  previousPreferences = serialized;
  const saved = saveCollaborationPreferences(preferences);
  const preferenceStatus = saved ? '参与飞机与机型配置已保存至本机浏览器' : '本机保存不可用或空间不足；配置仅本次会话有效';
  if (state.preferenceStatus !== preferenceStatus) useCollaborationStore.setState({ preferenceStatus });
});
