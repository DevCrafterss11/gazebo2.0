import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { advanceMission, CollaborationMockRuntime, createInitialMission, routePosition } from '../src/services/mock/CollaborationMockRuntime';
import { eligibility, validateTask } from '../src/domain/collaborationMission';
import { useCollaborationStore as store } from '../src/stores/collaborationStore';
import { seatRequirements, seatsFor } from '../src/domain/collaborationResources';
import { taskTypeNames } from '../src/types/collaboration';
const s = () => store.getState();
function setup(t: TestContext) {
  s().reset(); t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  t.after(() => { s().reset(); t.mock.timers.reset(); });
  s().enterSimulation(); s().startCluster(); t.mock.timers.tick(2000);
  assert.equal(s().clusterRunning, true);
}
/** First three drones that fit the task by the seat table (one per seat where possible). Fails loudly if the fleet cannot staff it. */
export function pickFor(index: number, count = 3): string[] {
  const type = taskTypeNames[index]!, picked: string[] = [];
  for (const seat of seatRequirements[type]) {
    const d = s().missionState.drones.find(x => !picked.includes(x.id) && seatsFor(x, type).some(item => item.role === seat.role));
    if (d) picked.push(d.id);
  }
  for (const d of s().missionState.drones) if (picked.length < count && !picked.includes(d.id) && seatsFor(d, type).length) picked.push(d.id);
  assert.ok(picked.length >= Math.min(2, count), `fleet can staff ${type}`);
  return picked.slice(0, count);
}
function configure(index = 0, ids = pickFor(index)) {
  s().selectTaskGroup(`group-${index + 1}`);
  for (const id of ids) s().assignDrone(id);
  for (const [x, y] of [[-30, -20], [32, -20], [30, 25], [-28, 25]]) s().addMapPoint({ x: x!, y: y!, z: 25, kind: 'point' });
  if (index < 2) assert.ok(s().closeTaskArea());
  s().updateGroupConfig(`group-${index + 1}`, { duration: 8 });
  s().addMapPoint({ x: -45, y: -25, z: 25, kind: 'start' });
  s().addMapPoint({ x: 43, y: 30, z: 25, kind: 'delivery' });
}
function start() { assert.ok(s().generateTaskPlan(), s().notice); assert.ok(s().prepareTask(), s().notice); assert.ok(s().distributeTask(), s().notice); assert.ok(s().armTask(), s().notice); assert.ok(s().startExecution(), s().notice); }
function step(t: TestContext, ticks: number) { for (let i = 0; i < ticks; i++) t.mock.timers.tick(850); }
// Physical takeoff/transit/landing is no longer compressed into a few ten-metre jumps.
function until(t: TestContext, predicate: () => boolean, seconds = 180) {
  for (let i = 0; i < seconds * 5 && !predicate(); i++) { t.mock.timers.tick(200); const group=s().missionState.groups.find(g=>g.lifecycle==='待结果确认'); if(group) s().confirmTaskResult(); }
  assert.ok(predicate(), `condition must be reached within ${seconds}s of simulated flight`);
}

test('15 independent resources and nodes have correct mapping, 3×5 homes, zero default assignments', (t) => {
  setup(t); const mission = s().missionState;
  assert.equal(mission.drones.length, 15); assert.equal(s().communicationNodes.length, 15);
  assert.equal(new Set(mission.drones.map((d) => d.position.x)).size, 5);
  assert.equal(new Set(mission.drones.map((d) => d.position.y)).size, 3);
  assert.equal(mission.groups.every((g) => !g.drones.length && !g.runId), true);
  mission.drones.forEach((d, i) => { assert.equal(d.id, `uav${i + 101}`); assert.equal(d.raspberryPiIp, `192.168.10.${i + 101}`); assert.equal(d.assignedTaskId, null); assert.equal(d.armed, false); assert.equal(d.instanceStatus, 'STANDBY'); assert.equal(d.droneType, i < 9 ? '侦察' : i < 12 ? '运输' : '中继'); assert.equal(d.payload, i >= 9 && i < 12 ? '抛投器' : i >= 12 && i < 14 ? '摄像头' : d.payload); });
  // The default fleet can staff every task on its own, including 先侦察后救援 and 双机确认.
  taskTypeNames.forEach((type, i) => assert.ok(pickFor(i).length >= 2, type));
  assert.equal(s().isRunning, false);
});

test('seat fit, visibility and draft roles do not allocate or change instance state', (t) => {
  setup(t);
  // A recon drone cannot join a transport task: refused with a readable reason, and nothing changes.
  s().selectTaskGroup('group-4'); s().assignDrone('uav101');
  assert.equal(s().missionState.groups[3]!.drones.length, 0); assert.match(s().notice, /物资运输需要运输/); assert.match(s().notice, /该机是侦察类型/);
  s().selectTaskGroup('group-1'); s().assignDrone('uav101'); s().setDroneRole('uav101', '侦察机'); s().toggleMapVisibility('uav101');
  let d = s().missionState.drones[0]!;
  assert.equal(d.visibleOnMap, false); assert.equal(d.assignedTaskId, null); assert.equal(d.currentRole, ''); assert.equal(d.instanceStatus, 'STANDBY');
  assert.equal(s().missionState.groups[0]!.roles[d.id], '侦察机');
  // An unavailable drone is refused (this replaces the removed "enabled" switch).
  store.setState(state => ({ missionState: { ...state.missionState, drones: state.missionState.drones.map((x, i) => i === 0 ? { ...x, available: false } : x) } }));
  d = s().missionState.drones[0]!;
  assert.match(eligibility(d, '区域巡逻'), /连接异常|不可用/); assert.equal(d.instanceStatus, 'STANDBY');
});

test('missing geometry and invalid eligibility block confirmation; only explicit current confirmation starts', (t) => {
  setup(t); s().startExecution(); assert.equal(s().isRunning, false); assert.equal(s().prepareTask(), false);
  configure(); s().startExecution(); assert.equal(s().isRunning, false);
  start(); assert.deepEqual(s().runningTaskGroupIds, ['group-1']);
  assert.equal(s().missionState.drones.filter((d) => d.assignedTaskId).length, 3);
  assert.equal(s().missionState.groups.slice(1).every((g) => g.lifecycle === '配置中'), true);
  assert.equal(s().missionState.drones.slice(3).every((d) => !d.armed && d.instanceStatus === 'STANDBY'), true);
  s().selectTaskGroup('group-2'); s().assignDrone(pickFor(1)[0]!); assert.equal(s().prepareTask(), false); s().startExecution();
  assert.deepEqual(s().runningTaskGroupIds, ['group-1']);
  // Resources are locked while a task runs: reconfiguring is refused.
  assert.equal(s().reconfigureDrone(s().missionState.groups[0]!.drones[0]!, { droneType: '运输', payload: '抛投器' }), false);
  assert.equal(s().missionState.drones.find(d => d.id === s().missionState.groups[0]!.drones[0])!.droneType, '侦察');
});

test('pause freezes current task and flight tracks, heartbeat persists; resume moves again', (t) => {
  setup(t); configure(); start(); until(t, () => s().missionState.groups[0]!.progress > 1); s().pauseExecution();
  const progress = s().missionState.groups[0]!.progress, trace = structuredClone(s().missionState.drones[0]!.trajectory), heartbeat = s().communicationNodes[0]!.heartbeatAt!;
  step(t, 5); assert.equal(s().missionState.groups[0]!.progress, progress); assert.deepEqual(s().missionState.drones[0]!.trajectory, trace); assert.ok(s().communicationNodes[0]!.heartbeatAt! > heartbeat);
  assert.equal(s().isPaused, true); s().resumeExecution(); until(t, () => s().missionState.groups[0]!.progress > progress);
});

test('individual RTL continues while paused, preserves other aircraft and releases only after landing', (t) => {
  setup(t); configure(); start(); until(t, () => s().missionState.groups[0]!.progress > 1); s().pauseExecution();
  const before = s().missionState.groups[0]!.progress; s().returnDrone('uav103');
  assert.equal(s().missionState.drones[2]!.instanceStatus, 'RETURNING'); assert.ok(s().missionState.drones[2]!.assignedTaskId);
  until(t, () => s().missionState.drones[2]!.instanceStatus === 'STANDBY', 60); const d = s().missionState.drones[2]!;
  assert.equal(d.instanceStatus, 'STANDBY'); assert.equal(d.assignedTaskId, null); assert.equal(d.armed, false); assert.deepEqual(d.position, d.homePosition); assert.ok(d.returnTrajectory.length);
  assert.equal(s().missionState.groups[0]!.progress, before); assert.equal(s().isRunning, true);
  assert.equal(s().missionState.drones[0]!.instanceStatus, 'FLYING');
  s().resumeExecution(); assert.equal(s().missionState.groups[0]!.lifecycle, '异常'); s().failExecution('分配航线成员退出'); until(t,()=>!s().isRunning); assert.equal(s().records[0]!.group.outcome,'failure');
});

test('planned member return degrades; unplanned role substitution is refused and failure returns safely', (t) => {
  setup(t); configure(); start(); until(t, () => s().missionState.groups[0]!.progress > 1); s().returnDrone('uav101');
  assert.equal(s().missionState.groups[0]!.lifecycle, '异常'); assert.equal(s().isRunning, true);
  const before = s().missionState.groups[0]!.progress; step(t, 2); assert.equal(s().missionState.groups[0]!.progress, before);
  s().resolveFailure('continue'); assert.match(s().notice,/重新.*规划/); step(t,2); assert.equal(s().missionState.groups[0]!.progress,before); s().failExecution('成员退出需重规划'); until(t,()=>!s().isRunning); assert.equal(s().records[0]!.group.outcome,'failure');
});

test('terminate freezes route progress, safely returns, archives immutable record, cluster stays running', (t) => {
  setup(t); configure(); start(); step(t, 10); const progress = s().missionState.groups[0]!.progress;
  s().terminateExecution(); assert.equal(s().missionState.groups[0]!.lifecycle, '安全收尾'); assert.equal(s().isRunning, true);
  step(t, 20); assert.equal(s().isRunning, false); assert.equal(s().clusterRunning, true); assert.equal(s().missionState.groups[0]!.progress, progress);
  assert.equal(s().records.length, 1); assert.equal(s().records[0]!.evaluation.status, '已终止'); assert.ok(s().records[0]!.evaluation.completion < 100);
  const snapshot = structuredClone(s().records[0]); s().newTask(true); start(); step(t, 2);
  assert.deepEqual(s().records[0], snapshot); assert.equal(s().missionState.groups[0]!.lifecycle, '执行中');
});

for (let index = 0; index < 5; index++) test(`${taskTypeNames[index]} executes independently, naturally returns and generates type-specific metrics`, (t) => {
  setup(t); configure(index); start(); until(t, () => !s().isRunning);
  assert.equal(s().isRunning, false); assert.equal(s().clusterRunning, true); assert.equal(s().records.length, 1);
  assert.equal(s().records[0]!.type, taskTypeNames[index]); assert.equal(s().evaluation!.groups.length, 1); assert.equal(s().evaluation!.completion, 100);
  assert.equal(s().records[0]!.group.lifecycle, '已完成'); assert.ok(s().records[0]!.evaluation.groups[0]!.trajectorySamples > 15);
  assert.equal(s().missionState.drones.every((d) => !d.assignedTaskId && !d.armed), true);
  assert.equal(s().missionState.groups.filter((g) => g.status === 'COMPLETE').length, 1);
  const members = s().records[0]!.group.drones;
  assert.equal(s().missionState.drones.filter((d) => !members.includes(d.id)).every((d) => !d.trajectory.length), true);
});

test('five routes differ and monitoring dwell depends on configured time', () => {
  const mission = createInitialMission();
  const positions = mission.groups.map((g, i) => routePosition(g, i, 65));
  assert.equal(new Set(positions.map((p) => `${p.x},${p.y}`)).size, 5);
  const monitoring = mission.groups[2]!;
  assert.deepEqual(routePosition(monitoring, 2, 65), routePosition(monitoring, 2, 90));
  assert.notDeepEqual(routePosition(mission.groups[0]!, 0, 65), routePosition(mission.groups[0]!, 0, 90));
});

test('simulated anomaly and handling are recorded in actual task evaluation', (t) => {
  setup(t); configure(); start(); step(t, 8); s().injectFailure('LOW_BATTERY', 'uav103');
  assert.equal(s().missionState.drones[2]!.instanceStatus, 'RETURNING');
  assert.equal(s().missionState.drones[0]!.instanceStatus, 'FLYING');
  s().failExecution('低电量导致分配航线未完成'); until(t,()=>!s().isRunning); assert.equal(s().records[0]!.evaluation.anomalyCount, 2, 'injected alert and explicit failed acceptance are recorded');
  assert.ok(s().records[0]!.events.some((e) => e.title === '单机返航落地'));
});

test('cluster stop waits for safety state and never kills armed instances immediately', (t) => {
  setup(t); configure(); start(); step(t, 10); s().stopCluster();
  assert.equal(s().stopRequested, true); assert.equal(s().clusterRunning, true);
  step(t, 20); assert.equal(s().clusterRunning, false); assert.equal(s().missionState.drones.every((d) => !d.armed && d.instanceStatus === 'STOPPED'), true);
  assert.equal(s().records.length, 1);
});

test('navigation cannot forge readiness and retains execution; timer start is idempotent and reset cleans up', (t) => {
  setup(t); configure(); start(); step(t, 2); s().setStep(3); s().setStep(4); assert.equal(s().isRunning, true);
  s().reset(); s().setStep(4); assert.equal(s().currentStep, 0); step(t, 20); assert.equal(s().missionState.drones[0]!.updatedAt <= Date.now(), true); assert.equal(s().events.length, 0);
  const runtime = new CollaborationMockRuntime(); let count = 0; let mission = createInitialMission();
  runtime.start(() => mission, (m) => { mission = m; count++; }); runtime.start(() => mission, (m) => { mission = m; count++; });
  t.mock.timers.tick(800); assert.equal(count, 4); runtime.stopCluster(); t.mock.timers.tick(800); assert.equal(count, 4);
  assert.deepEqual(advanceMission(mission), mission);
});


test('distant members must arrive before route progress or monitoring dwell advances', (t) => {
  setup(t); configure(2); start();
  store.setState((state) => ({ missionState: { ...state.missionState, drones: state.missionState.drones.map((d, i) => i === 0 ? { ...d, position: { x: 800, y: 800, z: 0 } } : d) } }));
  step(t, 15);
  assert.ok(s().missionState.groups[2]!.progress < 12); // takeoff waypoint can be reached, but no on-station work
  assert.equal(s().missionState.groups[2]!.dwellTicks, 0);
  assert.equal(s().records.length, 0);
});

test('monitoring counts configured dwell only after arrival, pauses freeze the count', (t) => {
  setup(t); configure(2); s().updateGroupConfig('group-3', { duration: 25 }); start();
  until(t,()=>s().missionState.groups[2]!.execution!.aircraft[0]!.dwell>0);
  let group=s().missionState.groups[2]!;
  const dwellBeforePause=group.execution!.aircraft[0]!.dwell;
  assert.ok(dwellBeforePause>0&&dwellBeforePause<=.21);
  assert.equal(group.execution!.aircraft[1]!.dwell,0);
  assert.equal(s().missionState.drones[1]!.instanceStatus,'STANDBY');
  s().pauseExecution();step(t,10);assert.equal(s().missionState.groups[2]!.execution!.aircraft[0]!.dwell,dwellBeforePause);
  s().resumeExecution(); until(t,()=>!s().isRunning,300);group=s().records[0]!.group;
  assert.ok(group.execution!.aircraft.every(a=>a.dwell+1e-6>=25), JSON.stringify({execution:group.execution,outcome:group.outcome,reason:group.failureReason}));
  const total=group.execution!.aircraft.reduce((n,a)=>n+a.dwell,0);
  assert.equal(s().records[0]!.evaluation.groups[0]!.metrics.find(m=>m.label==='实际驻留总时长')!.value,`${total.toFixed(1)} s`);
});

for (const [index, confirmation] of [[1, '人工复核'], [3, '人工签收']] as const) test(`${confirmation} waits at actual destination until explicit confirmation`, (t) => {
  setup(t); configure(index); s().updateGroupConfig(`group-${index + 1}`, { confirmation }); start();
  for (let i = 0; i < 120 && s().missionState.groups[index]!.lifecycle !== '待结果确认'; i++) step(t, 1);
  assert.equal(s().missionState.groups[index]!.lifecycle, '待结果确认');
  assert.equal(s().records.length, 0); assert.equal(s().isRunning, true);
  const group=s().missionState.groups[index]!;
  for (const route of group.plan!.routes) { const d=s().missionState.drones.find(d=>d.id===route.droneId)!; const target=route.waypoints.at(-1)!; assert.ok(Math.hypot(d.position.x-target.x,d.position.y-target.y)<.3); }
  step(t, 10); assert.equal(s().records.length, 0);
  s().confirmTaskResult(); assert.equal(s().missionState.groups[index]!.lifecycle, '安全收尾');
  // Return time depends on how far each member's home is from the task area, so wait for the record rather than a fixed count.
  for (let i = 0; i < 90 && !s().records.length; i++) step(t, 1);
  assert.equal(s().records.length, 1);
  assert.equal(s().records[0]!.evaluation.completion, 100);
  assert.equal(s().records[0]!.events.filter((e) => e.title === '模拟人工结果确认').length, 1);
  assert.equal(s().clusterRunning, true);
});

test('single search target expands to scan area; dual confirmation requires two aircraft', (t) => {
  setup(t); configure(1, [pickFor(1, 1)[0]!]); s().clearMapPoints(); s().addMapPoint({ x: 0, y: 0, z: 27, kind: 'point' });
  let group = s().missionState.groups[1]!;
  assert.ok(validateTask(s().missionState, group).some((e) => e.includes('双机确认还差 1 架')));
  s().updateGroupConfig('group-2', { confirmation: '人工复核' }); group = s().missionState.groups[1]!;
  assert.deepEqual(validateTask(s().missionState, group), []);
  assert.notDeepEqual(routePosition(group, 1, 0), routePosition(group, 1, 100));
  const narrow = routePosition(group, 1, 0); s().updateGroupConfig('group-2', { searchRange: 150 });
  assert.notDeepEqual(narrow, routePosition(s().missionState.groups[1]!, 1, 0));
});

test('rerunning at the same timestamp never archives prior events twice', (t) => {
  setup(t); configure(); start(); const timestamp = Date.now(); s().terminateExecution(); step(t, 1);
  assert.equal(s().records.length, 1);
  const firstIds = new Set(s().records[0]!.events.map((e) => e.id));
  t.mock.timers.setTime(timestamp); s().newTask(true); start(); s().terminateExecution(); step(t, 1);
  assert.equal(s().records.length, 2);
  assert.equal(s().records[1]!.events.some((e) => firstIds.has(e.id)), false);
});

test('student validation rejects invalid parameters, missing key roles and degenerate drawn areas', (t) => {
  setup(t); configure();
  s().updateGroupConfig('group-1', { altitude: 0 });
  assert.equal(s().missionState.groups[0]!.config.altitude, 0, 'invalid finite inputs remain editable');
  assert.equal(s().prepareTask(), false); assert.match(s().notice, /飞行高度/);
  s().updateGroupConfig('group-1', { altitude: 25 });
  s().setDroneRole('uav101', '协同机');
  assert.equal(s().prepareTask(), false); assert.match(s().notice, /领航机/);
  s().setDroneRole('uav101', '领航机');
  for (const polygon of [[[0,0],[10,0],[20,0]], [[0,0],[20,20],[0,20],[20,0]], [[0,0],[20,0],[20,20],[20,0]]]) {
    s().clearMapPoints(); for (const [x,y] of polygon) s().addMapPoint({x:x!,y:y!,z:25,kind:'point'});
    assert.equal(s().prepareTask(), false); assert.match(s().notice, /顶点不能/);
  }
  s().clearMapPoints(); for (const [x,y] of [[0,0],[20,0],[20,20],[0,20]]) s().addMapPoint({x:x!,y:y!,z:25,kind:'point'});
  assert.ok(s().closeTaskArea()); assert.ok(s().generateTaskPlan()); assert.equal(s().prepareTask(), true);
  s().cancelTaskPreparation(); assert.equal(s().missionState.groups[0]!.lifecycle, '配置中');
  assert.equal(s().startExecution(), false); assert.equal(s().isRunning, false);
});

test('two-aircraft confirmation cannot resume with one aircraft after independent RTL', (t) => {
  setup(t); configure(1, ['uav101','uav102']); s().updateGroupConfig('group-2', {confirmation:'双机确认'}); start(); step(t, 3);
  s().returnDrone('uav102'); assert.equal(s().missionState.groups[1]!.lifecycle, '异常');
  const progress = s().missionState.groups[1]!.progress;
  s().resolveFailure('continue'); assert.match(s().notice, /重新.*规划/);
  step(t, 5); assert.equal(s().missionState.groups[1]!.progress, progress);
  assert.equal(s().missionState.groups[1]!.lifecycle, '异常');
  s().terminateExecution(); step(t, 40); assert.equal(s().isRunning, false); assert.equal(s().clusterRunning, true);
  assert.equal(s().records[0]!.evaluation.anomalyCount, 1, 'insufficient-resource RTL is counted as an alert');
});

test('monitoring click replaces its single target and ended tasks require explicit rerun configuration', (t) => {
  setup(t); configure(2);
  assert.equal(s().missionState.groups[2]!.points.filter(p=>p.kind==='point').length, 1);
  s().addMapPoint({x:5,y:6,z:25,kind:'point'});
  assert.deepEqual(s().missionState.groups[2]!.points.filter(p=>p.kind==='point'), [{x:5,y:6,z:25,kind:'point'}]);
  start(); step(t, 3); s().terminateExecution(); step(t, 40);
  assert.equal(s().isRunning, false); assert.equal(s().prepareTask(), false);
  assert.match(s().notice, /再次执行|新建|配置阶段/); assert.equal(s().records.length, 1);
  s().newTask(true); start();
  assert.equal(s().records.length, 1, 'rerun preserves history');
});

test('past evaluations stay accessible while a new task is running', (t) => {
  setup(t); configure(); start(); until(t,()=>!s().isRunning);
  assert.equal(s().records.length, 1);
  s().newTask(true); start(); s().setStep(4); s().setStep(5);
  assert.equal(s().currentStep, 5, 'starting a task must not hide completed records');
  assert.equal(s().isRunning, true);
});

test('cluster stop during successful safety cleanup preserves the completed result', (t) => {
  setup(t); configure(); start();
  for (let i = 0; i < 200 && s().missionState.groups[0]!.lifecycle !== '安全收尾'; i++) step(t, 1);
  assert.equal(s().missionState.groups[0]!.status, 'COMPLETE');
  s().stopCluster(); step(t, 40);
  assert.equal(s().clusterRunning, false);
  assert.equal(s().records[0]!.group.lifecycle, '已完成');
  assert.equal(s().records[0]!.events.some((e) => e.title === '任务终止'), false);
});

test('partial monitoring dwell cannot be evaluated as a completed monitoring point', (t) => {
  setup(t); configure(2); s().updateGroupConfig('group-3', { duration: 60 }); start();
  until(t, () => (s().missionState.groups[2]!.dwellTicks ?? 0) * .85 >= 1);
  assert.ok(s().missionState.groups[2]!.dwellTicks);
  s().terminateExecution(); step(t, 40);
  const metrics = s().records[0]!.evaluation.groups[0]!.metrics;
  assert.equal(s().records[0]!.group.execution!.aircraft.filter(a=>a.completed).length,0);
  assert.ok(parseFloat(metrics.find(m=>m.label==='实际驻留总时长')!.value)>0);
  assert.equal(s().records[0]!.evaluation.completedGroups,0);
});

test('repeated runtime start requests preserve the existing execution cadence', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const runtime = new CollaborationMockRuntime(); t.after(() => { runtime.stopCluster(); t.mock.timers.reset(); });
  const mission = createInitialMission(); let updates = 0;
  const begin = () => runtime.start(() => mission, () => { updates++; });
  begin(); t.mock.timers.tick(100); begin(); t.mock.timers.tick(100);
  assert.equal(updates, 1, 'a second command must not postpone the shared clock');
  t.mock.timers.tick(200); assert.equal(updates, 2);
});

// The map must follow runtime coordinates, never synthesize positions from UAV order.
test('satellite ENU frame roundtrips arbitrary world positions at different scene origins', async () => {
  const { collaborationMapFrame, teachingMapReference } = await import('../src/domain/collaborationMap');
  for (const origin of [teachingMapReference.origin, [116.3268, 40.0098] as [number, number]]) {
    const frame = collaborationMapFrame({ origin, axes: 'ENU' });
    assert.deepEqual(frame.toGeo({ x: 0, y: 0 }).map(v => Math.round(v * 1e7)), origin.map(v => Math.round(v * 1e7)));
    for (const p of [{ x: -48, y: 28 }, { x: 85.3, y: -150.8 }, { x: -603, y: 409 }]) {
      const local = frame.toLocal(frame.toGeo(p));
      assert.ok(Math.abs(local.x - p.x) < 1e-6);
      assert.ok(Math.abs(local.y - p.y) < 1e-6);
      assert.ok(Math.sign(frame.toGeo(p)[0] - origin[0]) === Math.sign(p.x));
      assert.ok(Math.sign(frame.toGeo(p)[1] - origin[1]) === Math.sign(p.y));
    }
  }
});

test('drawing inverse uses one metre scale on desktop and portrait, including pan and zoom', async () => {
  const { mapPixelToLocal, mapMetreScale, mapScaleBar } = await import('../src/domain/collaborationMap');
  for (const size of [{ width: 1600, height: 900 }, { width: 390, height: 600 }]) {
    const pan = { x: 85, y: -42 }, zoom = .65, position = { x: 33, y: -23 };
    const scale = mapMetreScale(size.width, size.height) * zoom;
    const pixel = { x: size.width / 2 + pan.x + position.x * scale, y: size.height / 2 + pan.y - position.y * scale };
    const local = mapPixelToLocal(pixel, size, pan, zoom);
    assert.ok(Math.abs(local.x - position.x) < 1e-10 && Math.abs(local.y - position.y) < 1e-10);
    const bar = mapScaleBar(scale);
    assert.equal(bar.pixels, bar.metres * scale);
    assert.ok(bar.pixels <= 100 && bar.pixels >= 20);
  }
});

test('runtime updates and archived records retain the scene georeference', t => {
  setup(t); configure(); start();
  const reference = structuredClone(s().missionState.mapReference);
  step(t, 3);
  assert.deepEqual(s().missionState.mapReference, reference);
  s().terminateExecution(); step(t, 120);
  assert.deepEqual(s().records[0]?.mapReference, reference);
});

test('coordinate grid ticks remain registered to ENU through zoom, pan and portrait resizing', async () => {
  const { mapGridLines, mapMetreScale, mapScaleBar } = await import('../src/domain/collaborationMap');
  for (const size of [{ width: 2048, height: 1000 }, { width: 390, height: 600 }]) {
    for (const zoom of [.1, .85, 5]) {
      const pan = { x: 91, y: -47 }, scale = mapMetreScale(size.width, size.height) * zoom;
      const lines = mapGridLines(size, pan, scale);
      assert.ok(lines.length > 0 && lines.length < 150);
      for (const line of lines) {
        const extent = line.axis === 'E' ? size.width : size.height;
        const origin = extent / 2 + (line.axis === 'E' ? pan.x : pan.y);
        const direction = line.axis === 'E' ? 1 : -1;
        assert.ok(line.pixel >= -1e-8 && line.pixel <= extent + 1e-8);
        assert.ok(Math.abs((line.pixel - origin) / scale * direction - line.value) < 1e-8);
      }
      for (const axis of ['E', 'N'] as const) {
        const ticks = lines.filter(line => line.axis === axis);
        for (let i = 1; i < ticks.length; i++) {
          assert.ok(Math.abs(ticks[i]!.value - ticks[i - 1]!.value - mapScaleBar(scale).metres) < 1e-8);
        }
      }
    }
  }
});


test('5m initial array is metric in both axes and telemetry starts stationary', () => {
  const { drones } = createInitialMission();
  for (let i = 0; i < drones.length; i++) {
    const drone = drones[i]!;
    assert.deepEqual(drone.velocity, { x: 0, y: 0, z: 0 });
    assert.deepEqual(drone.position, drone.homePosition);
    if (i % 5 < 4) assert.equal(Math.hypot(drone.position.x - drones[i + 1]!.position.x, drone.position.y - drones[i + 1]!.position.y), 5);
    if (i < 10) assert.equal(Math.hypot(drone.position.x - drones[i + 5]!.position.x, drone.position.y - drones[i + 5]!.position.y), 5);
  }
});

test('5Hz telemetry agrees with position deltas, climb limits, cruise bounds and pause/RTL', (t) => {
  setup(t); configure(3); start();
  const lead = s().missionState.groups[3]!.drones[0]!, leadIndex = s().missionState.drones.findIndex(d => d.id === lead);
  const initialBattery = s().missionState.drones[leadIndex]!.battery;
  for (let i = 0; i < 150; i++) {
    const before = structuredClone(s().missionState.drones[leadIndex]!);
    t.mock.timers.tick(200);
    const after = s().missionState.drones[leadIndex]!;
    for (const axis of ['x', 'y', 'z'] as const) assert.ok(Math.abs(after.velocity[axis] - (after.position[axis] - before.position[axis]) / .2) < 1e-8);
    assert.ok(Math.hypot(after.velocity.x, after.velocity.y) <= after.speed + 1e-8);
    assert.ok(Math.abs(after.velocity.z) <= 3 + 1e-8);
    assert.ok(Math.abs(((after.attitude[2] - before.attitude[2] + 540) % 360) - 180) <= 18 + 1e-8);
    if (after.mode === 'TAKEOFF') assert.deepEqual({x: after.position.x, y: after.position.y}, {x: after.homePosition.x, y: after.homePosition.y});
    assert.ok(after.battery <= before.battery);
  }
  assert.ok(s().missionState.drones[leadIndex]!.battery < initialBattery);
  s().pauseExecution();
  assert.deepEqual(s().missionState.drones[leadIndex]!.velocity, {x:0,y:0,z:0});
  const paused = structuredClone(s().missionState.drones[leadIndex]!); step(t, 2);
  assert.deepEqual(s().missionState.drones[leadIndex]!.position, paused.position);
  assert.ok(s().missionState.drones[leadIndex]!.battery < paused.battery, 'hover still consumes energy');
  s().returnDrone(lead);
  until(t, () => s().missionState.drones[leadIndex]!.instanceStatus === 'STANDBY', 90);
  const landed = s().missionState.drones[leadIndex]!;
  assert.deepEqual(landed.position, landed.homePosition); assert.deepEqual(landed.velocity, {x:0,y:0,z:0}); assert.equal(landed.armed, false);
});

test('experiment 3 owns independent flat vector and copied satellite map styles', async () => {
  const { collaborationBasemapStyle, collaborationBasemapSourceId } = await import('../src/domain/collaborationBasemap');
  const vector = collaborationBasemapStyle('vector'), satellite = collaborationBasemapStyle('satellite');
  assert.equal(vector.sources[collaborationBasemapSourceId]!.type, 'vector');
  assert.equal(satellite.sources[collaborationBasemapSourceId]!.type, 'raster');
  assert.ok(vector.layers.every(layer => layer.type !== 'fill-extrusion'));
  vector.layers.pop(); assert.notEqual(vector.layers.length, collaborationBasemapStyle('vector').layers.length);
});

test('response-time evaluation uses trajectory timestamps rather than the former .85s sample count', async () => {
  const { evaluateMission } = await import('../src/domain/collaborationMission');
  const mission = createInitialMission(), group = mission.groups[4]!;
  group.runId = 'timed'; group.drones = ['uav101'];
  const target = routePosition(group, 4, 100);
  mission.drones[0]!.trajectory = [
    { x: target.x - 30, y: target.y, z: target.z, timestamp: 1000 },
    { x: target.x - 20, y: target.y, z: target.z, timestamp: 1200 },
    { ...target, timestamp: 11000 },
  ];
  const evaluation = evaluateMission(mission, [], 10);
  assert.equal(evaluation.groups[0]!.metrics.find(metric => metric.label === '响应时间')!.value, '10 s');
});
