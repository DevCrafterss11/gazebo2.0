import assert from 'node:assert/strict';
import { test } from 'node:test';
import { useCollaborationStore as store } from '../src/stores/collaborationStore';
import { insidePolygon } from '../src/domain/collaborationPlanning';

const state = () => store.getState();

test('five fresh task drafts acquire disjoint resources, execute concurrently and release on landing', t => {
  state().reset();
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  t.after(() => { state().reset(); t.mock.timers.reset(); });
  state().enterSimulation(); state().startCluster(); t.mock.timers.tick(2000);
  state().toggleConcurrentMode();
  assert.equal(state().concurrentMode, true);
  for (let i = 0; i < 5; i++) {
    const id = `group-${i + 1}`;
    state().selectTaskGroup(id);
    state().loadTaskExample();
    assert.equal(state().missionState.groups[i]!.drones.length, 3, state().notice);
    assert.ok(state().generateTaskPlan(), `${id} plan: ${state().notice}`);
    const plan = state().missionState.groups[i]!.plan!;
    assert.ok(plan.routes.every(r => r.waypoints.length > 1));
    if (i < 2) {
      // Every aircraft sweeps at least two distinct strips inside its own clipped partition.
      for (const region of plan.regions) {
        const waypoints = plan.routes.find(r => r.droneId === region.droneId)!.waypoints.slice(1);
        assert.ok(waypoints.length >= 4, `${id} ${region.name} must cover more than one row`);
        assert.ok(waypoints.every(p => insidePolygon(p, region.polygon)), `${id} ${region.name} escaped its region`);
        const a = waypoints[0]!, b = waypoints[1]!;
        assert.ok(waypoints.some(p => Math.abs((b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x)) > 0.1), `${id} ${region.name} is collinear`);
      }
    }
    assert.ok(state().prepareTask(), `${id} prepare: ${state().notice}`);
    assert.ok(state().distributeTask(), `${id} upload: ${state().notice}`);
    assert.ok(state().armTask(), `${id} arm: ${state().notice}`);
    assert.ok(state().submitTaskToScheduler(id), `${id} schedule: ${state().notice}`);
    assert.equal(state().schedulerState.activeRuns.length, i + 1);
    assert.equal(state().runningTaskGroupIds.length, i + 1);
    assert.equal(state().getResourcePoolSnapshot().leasedDrones.length, (i + 1) * 3);
  }
  const assigned = state().missionState.groups.flatMap(g => g.drones);
  assert.equal(new Set(assigned).size, 15);
  assert.equal(state().schedulerState.stats.maxConcurrencySeen, 5);
  state().selectTaskGroup('group-1');
  const firstRun = state().schedulerState.activeRuns.find(r => r.groupId === 'group-1')!;
  assert.ok(state().pauseTaskRun(firstRun.id));
  const firstSeconds = state().missionState.groups[0]!.execution!.seconds;
  t.mock.timers.tick(2000);
  assert.equal(state().missionState.groups[0]!.execution!.seconds, firstSeconds);
  assert.ok(state().missionState.groups[1]!.execution!.seconds > 0);
  assert.ok(state().resumeTaskRun(firstRun.id));
  for (let i = 0; i < 1500 && state().isRunning; i++) {
    t.mock.timers.tick(200);
    const awaiting = state().missionState.groups.filter(g => g.lifecycle === '待结果确认');
    for (const group of awaiting) { state().selectTaskGroup(group.id); state().confirmTaskResult(); }
  }
  assert.equal(state().isRunning, false, state().missionState.groups.map(g => `${g.id}:${g.lifecycle}:${g.failureReason}`).join(' / '));
  assert.equal(state().records.length, 5);
  assert.equal(state().schedulerState.activeRuns.length, 0);
  assert.equal(state().getResourcePoolSnapshot().availableDrones.length, 15);
  for (const index of [1, 3, 4]) {
    const group = state().records.find(r => r.groupId === `group-${index + 1}`)!.group;
    const relayId = group.drones.find(id => group.roles[id] === '中继机' || group.roles[id] === '护航机');
    assert.ok(relayId, `task ${index + 1} should actually dispatch a relay-type seat`);
    assert.ok(group.execution!.aircraft.find(a => a.droneId === relayId)!.completed, `relay ${relayId} should finish its assigned route`);
  }
  assert.ok(state().records.every(r => r.group.outcome === 'success'), state().records.map(r => `${r.name}: ${r.group.failureReason}`).join(' / '));
});


test('a running group cannot be replaced; cancellation holds its leases until landing and other runs advance', t => {
  state().reset();
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  t.after(() => { state().reset(); t.mock.timers.reset(); });
  state().enterSimulation(); state().startCluster(); t.mock.timers.tick(2000); state().toggleConcurrentMode();
  for (const id of ['group-1', 'group-2']) {
    state().selectTaskGroup(id); state().loadTaskExample();
    assert.ok(state().generateTaskPlan(), state().notice);
    assert.ok(state().prepareTask(), state().notice);
    assert.ok(state().distributeTask(), state().notice);
    assert.ok(state().armTask(), state().notice);
    assert.ok(state().submitTaskToScheduler(id), state().notice);
  }
  t.mock.timers.tick(4000); // both groups have actually taken off before cancellation
  state().selectTaskGroup('group-1');
  const first = state().missionState.groups[0]!;
  state().newTask();
  assert.equal(state().missionState.groups[0]!.runId, first.runId);
  assert.match(state().notice, /不能覆盖/);
  const secondBefore = state().missionState.groups[1]!.execution!.seconds;
  assert.ok(state().cancelTaskRun(first.runId!));
  assert.equal(state().missionState.groups[0]!.lifecycle, '安全收尾');
  assert.equal(state().getResourcePoolSnapshot().leasedDrones.length, 6);
  t.mock.timers.tick(1000);
  assert.ok(state().missionState.groups[1]!.execution!.seconds > secondBefore);
  assert.ok(state().getResourcePoolSnapshot().leasedDrones.length >= 3);
  for (let i=0;i<800 && state().missionState.groups[0]!.lifecycle === '安全收尾';i++) t.mock.timers.tick(200);
  assert.equal(state().missionState.groups[0]!.lifecycle, '已终止');
  assert.equal(state().schedulerState.activeRuns.length, 1);
  assert.equal(state().getResourcePoolSnapshot().leasedDrones.length, 3);
  assert.equal(state().records[0]!.group.outcome, 'cancelled');
  assert.equal(state().missionState.groups[1]!.runId !== null, true);
});


test('duplicate draft selection is refused before planning; stopping a paused fleet drains every lease', t => {
  state().reset(); t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  t.after(() => { state().reset(); t.mock.timers.reset(); });
  state().enterSimulation(); state().startCluster(); t.mock.timers.tick(2000); state().toggleConcurrentMode();
  state().selectTaskGroup('group-1'); state().loadTaskExample();
  assert.ok(state().generateTaskPlan(), state().notice);
  const duplicateId = state().missionState.groups[0]!.drones[0]!;
  state().selectTaskGroup('group-3'); state().loadTaskExample();
  // A preconfigured draft owns its selection; do not silently steal the first task's drone.
  const before = [...state().missionState.groups[2]!.drones];
  state().setTaskDrone('group-3', duplicateId, true);
  assert.deepEqual(state().missionState.groups[2]!.drones, before);
  assert.match(state().notice, /独立编组/);
  state().selectTaskGroup('group-1');
  assert.ok(state().prepareTask()); assert.ok(state().distributeTask()); assert.ok(state().armTask());
  assert.ok(state().submitTaskToScheduler('group-1'), state().notice);
  state().selectTaskGroup('group-3');
  assert.ok(state().generateTaskPlan(), state().notice);
  assert.ok(state().prepareTask()); assert.ok(state().distributeTask()); assert.ok(state().armTask());
  assert.ok(state().submitTaskToScheduler('group-3'), state().notice);
  t.mock.timers.tick(3500);
  const firstRun = state().schedulerState.activeRuns.find(r => r.groupId === 'group-1')!;
  assert.ok(state().pauseTaskRun(firstRun.id));
  state().stopCluster();
  assert.equal(state().stopRequested, true);
  assert.ok(state().schedulerState.activeRuns.length > 0);
  for (let i=0;i<800 && state().stopRequested;i++) t.mock.timers.tick(200);
  assert.equal(state().clusterRunning, false);
  assert.equal(state().schedulerState.activeRuns.length, 0);
  assert.equal(state().getResourcePoolSnapshot().leasedDrones.length, 0);
  assert.equal(state().records.length, 2);
});


test('five drafts can all upload and arm first, then launch in reverse order at the same planned altitude', t => {
  state().reset(); t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  t.after(() => { state().reset(); t.mock.timers.reset(); });
  state().enterSimulation(); state().startCluster(); t.mock.timers.tick(2000); state().toggleConcurrentMode();
  for (let i = 0; i < 5; i++) {
    const id = `group-${i + 1}`;
    state().selectTaskGroup(id); state().loadTaskExample();
    assert.equal(state().missionState.groups[i]!.drones.length, 3, state().notice);
    state().updateGroupConfig(id, { altitude: 18 });
    assert.ok(state().generateTaskPlan(), `${id}: ${state().notice}`);
  }
  assert.equal(new Set(state().missionState.groups.flatMap(g => g.drones)).size, 15);
  for (let i = 0; i < 5; i++) {
    state().selectTaskGroup(`group-${i + 1}`);
    assert.ok(state().prepareTask(), state().notice);
    assert.ok(state().distributeTask(), state().notice);
    assert.ok(state().armTask(), state().notice);
  }
  // Closing one deployment must not disarm or invalidate the other four.
  state().cancelTaskPreparation('group-2');
  assert.equal(state().missionState.groups[1]!.plan!.stage, 'planned');
  for (const i of [0, 2, 3, 4]) assert.equal(state().missionState.groups[i]!.plan!.stage, 'armed');
  state().selectTaskGroup('group-2');
  assert.ok(state().prepareTask(), state().notice);
  assert.ok(state().distributeTask(), state().notice);
  assert.ok(state().armTask(), state().notice);
  for (const i of [4, 3, 2, 1, 0]) {
    const id = `group-${i + 1}`; state().selectTaskGroup(id);
    assert.ok(state().submitTaskToScheduler(id), `${id}: ${state().notice}`);
    assert.equal(state().schedulerState.activeRuns.at(-1)!.altitudeBand[0], 18);
  }
  assert.equal(state().schedulerState.activeRuns.length, 5);
  assert.equal(state().runningTaskGroupIds.length, 5);
  assert.equal(state().getResourcePoolSnapshot().leasedDrones.length, 15);
  assert.ok(state().schedulerState.activeLeases.every(l => l.runId && state().schedulerState.activeRuns.some(r => r.id === l.runId)));
  for (let i = 0; i < 1500 && state().isRunning; i++) {
    t.mock.timers.tick(200);
    for (const g of state().missionState.groups.filter(g => g.lifecycle === '待结果确认')) {
      state().selectTaskGroup(g.id); state().confirmTaskResult();
    }
  }
  assert.equal(state().records.length, 5);
  assert.equal(state().schedulerState.activeRuns.length, 0);
  assert.equal(state().getResourcePoolSnapshot().leasedDrones.length, 0);
});


test('more aircraft than the shared fleet can support give an actionable full-team error, not a phantom lease', t => {
  state().reset(); t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  t.after(() => { state().reset(); t.mock.timers.reset(); });
  state().enterSimulation(); state().startCluster(); t.mock.timers.tick(2000); state().toggleConcurrentMode();
  state().selectTaskGroup('group-1'); state().loadTaskExample();
  state().setTaskDrone('group-1', 'uav104', true);
  for (let i = 1; i < 5; i++) {
    state().selectTaskGroup(`group-${i + 1}`);
    state().loadTaskExample();
    if (i < 4) assert.equal(state().missionState.groups[i]!.drones.length, 3, state().notice);
  }
  assert.equal(state().missionState.groups[4]!.drones.length, 0);
  assert.match(state().notice, /完整独立编组|移出冲突编组/);
  assert.equal(state().schedulerState.activeLeases.length, 0);
});

test('five independent controls pause, immediately resume, cancel and reject without cross-task interference', t => {
  state().reset(); t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  t.after(() => { state().reset(); t.mock.timers.reset(); });
  state().enterSimulation(); state().startCluster(); t.mock.timers.tick(2000); state().toggleConcurrentMode();
  for (let i = 1; i <= 5; i++) {
    const id = `group-${i}`;
    state().selectTaskGroup(id); state().loadTaskExample();
    assert.ok(state().generateTaskPlan(), state().notice);
    assert.ok(state().prepareTask(), state().notice);
    assert.ok(state().distributeTask(), state().notice);
    assert.ok(state().armTask(), state().notice);
    assert.ok(state().submitTaskToScheduler(id), state().notice);
  }
  const run = (id: number) => state().schedulerState.activeRuns.find(r => r.groupId === `group-${id}`)!;
  assert.ok(state().pauseTaskRun(run(1).id));
  assert.equal(run(1).status, 'paused');
  assert.equal(state().missionState.groups[0]!.lifecycle, '暂停');
  assert.ok(state().resumeTaskRun(run(1).id), 'resume must not need a simulator tick');
  assert.equal(run(1).status, 'running');
  assert.ok(state().pauseTaskRun(run(1).id));
  assert.ok(state().pauseTaskRun(run(2).id));
  const stoppedSeconds = state().missionState.groups[0]!.execution!.seconds;
  t.mock.timers.tick(2300);
  assert.equal(state().missionState.groups[0]!.execution!.seconds, stoppedSeconds);
  assert.ok(state().missionState.groups[2]!.execution!.seconds > 0);
  assert.ok(state().resumeTaskRun(run(1).id));
  assert.equal(run(2).status, 'paused');
  assert.ok(run(1).pausedDuration >= 2 && run(1).pausedDuration < 3, 'pause duration uses seconds');
  assert.deepEqual(run(1).events.filter(e => /暂停|恢复/.test(e.title)).map(e => e.title), ['任务暂停', '任务恢复', '任务暂停', '任务恢复']);
  const cancelledId = run(2).id;
  const airborne = state().missionState.drones.some(d => d.assignedTaskId === cancelledId && d.position.z > d.homePosition.z + .05);
  assert.ok(state().cancelTaskRun(cancelledId));
  assert.equal(state().missionState.groups[1]!.outcome, 'cancelled');
  if (airborne) {
    assert.equal(run(2).status, 'completing');
    assert.ok(state().getResourcePoolSnapshot().leasedDrones.some(d => d.runId === cancelledId), 'leases remain while returning');
  } else assert.ok(state().schedulerState.archivedRuns.some(r => r.id === cancelledId), 'grounded aircraft release immediately');
  for (let i = 0; i < 1500 && state().isRunning; i++) {
    t.mock.timers.tick(200);
    for (const g of state().missionState.groups.filter(g => g.lifecycle === '待结果确认')) {
      state().selectTaskGroup(g.id); state().confirmTaskResult(g.id !== 'group-4');
    }
  }
  assert.equal(state().records.length, 5);
  assert.deepEqual(state().records.map(r => [r.groupId, r.group.outcome]).sort(), [
    ['group-1', 'success'], ['group-2', 'cancelled'], ['group-3', 'success'], ['group-4', 'failure'], ['group-5', 'success'],
  ]);
  assert.equal(state().schedulerState.activeRuns.length, 0);
  assert.equal(state().schedulerState.archivedRuns.length, 5);
  assert.equal(state().getResourcePoolSnapshot().leasedDrones.length, 0);
});

test('an alert on a different concurrent run is attributed to that run and does not freeze its neighbor', t => {
  state().reset(); t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  t.after(() => { state().reset(); t.mock.timers.reset(); });
  state().enterSimulation(); state().startCluster(); t.mock.timers.tick(2000); state().toggleConcurrentMode();
  for (const id of ['group-1', 'group-2']) {
    state().selectTaskGroup(id); state().loadTaskExample();
    assert.ok(state().generateTaskPlan()); assert.ok(state().prepareTask());
    assert.ok(state().distributeTask()); assert.ok(state().armTask());
    assert.ok(state().submitTaskToScheduler(id), state().notice);
  }
  t.mock.timers.tick(4000);
  state().selectTaskGroup('group-1');
  const other = state().missionState.drones.find(d => d.taskGroupId === 'group-2' && d.instanceStatus === 'FLYING')!;
  assert.ok(other, 'second group must have a flying member');
  const progress = state().missionState.groups[0]!.execution!.seconds;
  state().injectFailure('LOW_BATTERY', other.id);
  assert.equal(state().events.at(-2)?.groupId, 'group-2', 'alert event belongs to the affected run');
  t.mock.timers.tick(1000);
  assert.ok(state().missionState.groups[0]!.execution!.seconds > progress);
});

test('step guards and a cancelled startup never resurrect a stopped cluster', t => {
  state().reset(); t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  t.after(() => { state().reset(); t.mock.timers.reset(); });
  state().setStep(4);
  assert.equal(state().currentStep, 0);
  state().enterSimulation(); state().setStep(1);
  assert.equal(state().currentStep, 1);
  state().setStep(4);
  assert.equal(state().currentStep, 1);
  state().startCluster();
  assert.equal(state().clusterStarting, true);
  state().stopCluster();
  t.mock.timers.tick(5000);
  assert.equal(state().clusterRunning, false);
  assert.equal(state().clusterStarting, false);
  assert.equal(state().schedulerState.activeRuns.length, 0);
  assert.equal(state().getResourcePoolSnapshot().leasedDrones.length, 0);
  state().setStep(4);
  assert.equal(state().currentStep, 1);
  state().startCluster(); t.mock.timers.tick(2000);
  assert.equal(state().clusterRunning, true);
  state().setStep(4);
  assert.equal(state().currentStep, 4);
});
