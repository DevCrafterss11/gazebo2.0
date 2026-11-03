import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { useCollaborationStore as store } from '../src/stores/collaborationStore';
import { advanceMission } from '../src/services/mock/CollaborationMockRuntime';
import { advanceGpsAttacks, startGpsAttack, stopGpsAttack } from '../src/services/mock/CollaborationGpsSimulator';
import { defaultAttackConfig } from '../src/domain/basicAttackConfig';
import { attackedTrajectorySegments } from '../src/domain/collaborationGps';
import { GpsAttackTrace, GpsMapLayer } from '../src/experiments/collaboration/components/GpsMapLayer';
import type { Mission } from '../src/types/collaboration';
const state = () => store.getState();
function concurrentMission(t: TestContext): Mission {
  state().reset();
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  t.after(() => { state().reset(); t.mock.timers.reset(); });
  state().enterSimulation(); state().startCluster(); t.mock.timers.tick(2000); state().toggleConcurrentMode();
  for (let i = 0; i < 5; i++) {
    const id = `group-${i + 1}`;
    state().selectTaskGroup(id); state().loadTaskExample();
    assert.ok(state().generateTaskPlan(), state().notice);
    assert.ok(state().prepareTask(), state().notice); assert.ok(state().distributeTask(), state().notice);
    assert.ok(state().armTask(), state().notice); assert.ok(state().submitTaskToScheduler(id), state().notice);
  }
  t.mock.timers.tick(10000);
  return structuredClone(state().missionState);
}
function config(ids: string[]) {
  const c = defaultAttackConfig('GPS_SPOOFING');
  c.targetDroneIds = ids; c.severity = 'high'; c.values.offsetX = 14; c.values.offsetY = 7;
  return c;
}
function advance(mission: Mission, ticks: number) { for (let i = 0; i < ticks; i++) mission = advanceMission(mission, false, .2); return mission; }

test('five concurrent task types: physical deviation, reported positions, red provenance and unaffected aircraft', t => {
  const original = concurrentMission(t), ids = original.groups.map(g => original.drones.find(d => g.drones.includes(d.id) && d.instanceStatus === 'FLYING')!.id);
  const baseline = advance(original, 25), attacked = advance(startGpsAttack(original, config(ids)), 25);
  for (const d of attacked.drones) {
    const normal = baseline.drones.find(n => n.id === d.id)!;
    if (ids.includes(d.id)) {
      assert.ok(Math.hypot(d.position.x - normal.position.x, d.position.y - normal.position.y) > .1, `${d.id} ${d.taskGroupId} should physically deviate`);
      assert.equal(d.reportedPosition!.x - d.position.x, 14);
      assert.ok(d.trajectory.some(p => p.gpsAttackId));
      assert.match(renderToStaticMarkup(<GpsAttackTrace drone={d} selected={false} />), /stroke="#ff4545"/);
    } else {
      assert.equal(d.gpsAttack, undefined);
      // Dependent teammates may launch earlier/later as an attacked leader changes task progress.
      assert.ok(!d.trajectory.some(p => p.gpsAttackId));
    }
  }
  assert.match(renderToStaticMarkup(<GpsMapLayer drones={attacked.drones} scale={2} selectedId={ids[0]} />), /GPS · Δ平面/);
  assert.equal(original.drones.filter(d => d.gpsAttack).length, 0);
});

test('arbitrary target counts, independent sessions, atomic duplicate rejection, single-target stop and history', t => {
  const original = concurrentMission(t), ids = original.drones.map(d => d.id);
  const all = startGpsAttack(original, config(ids));
  assert.equal(all.drones.filter(d => d.gpsAttack).length, 15);
  assert.throws(() => startGpsAttack(all, config(ids)), /已有 GPS/);
  const first = startGpsAttack(original, config(ids.slice(0, 2)));
  const second = advance(startGpsAttack(first, config(ids.slice(2))), 5);
  assert.notEqual(second.drones[0]!.gpsAttack!.id, second.drones[2]!.gpsAttack!.id);
  const stopped = stopGpsAttack(second, [ids[0]!]);
  assert.equal(stopped.drones.filter(d => d.gpsAttack).length, 14);
  const after = advance(stopped, 2), d = after.drones[0]!;
  assert.equal(d.gpsAttack, undefined); assert.equal(d.reportedPosition, undefined);
  assert.ok(attackedTrajectorySegments(d.trajectory).length > 0);
  assert.equal(d.trajectory.at(-1)!.gpsAttackId, undefined);
  assert.throws(() => startGpsAttack(original, config([])), /至少一架/);
  assert.throws(() => startGpsAttack(original, config(['missing'])), /离开当前任务/);
});

test('delay, expiry, gradual/path interpolation and deterministic noise', t => {
  const original = concurrentMission(t), id = original.drones[0]!.id;
  const c = config([id]); c.values.delay = 1; c.values.duration = 2; c.values.interval = 200;
  let m = advanceGpsAttacks(startGpsAttack(original, c), .5);
  assert.equal(m.drones[0]!.gpsAttack!.phase, 'delayed'); assert.equal(m.drones[0]!.gpsAttack!.offset.x, 0);
  m = advanceGpsAttacks(m, .5); assert.equal(m.drones[0]!.gpsAttack!.offset.x, 14);
  m = advanceGpsAttacks(m, 2); assert.equal(m.drones[0]!.gpsAttack, undefined);
  c.values.delay = 0; c.values.duration = 20; c.values.mode = 'gradual'; c.values.ramp = 10;
  m = advanceGpsAttacks(startGpsAttack(original, c), 5); assert.equal(m.drones[0]!.gpsAttack!.offset.x, 7);
  c.values.mode = 'path'; c.values.waypoints = '0,0,0\n20,0,0';
  m = advanceGpsAttacks(startGpsAttack(original, c), 10); assert.equal(m.drones[0]!.gpsAttack!.offset.x, 10);
  c.values.noise = 3;
  const a = advanceGpsAttacks(startGpsAttack(original, c), 10).drones[0]!.gpsAttack!.offset;
  const b = advanceGpsAttacks(startGpsAttack(original, c), 10).drones[0]!.gpsAttack!.offset;
  assert.deepEqual(a, b);
});

test('disconnect policies, boundary stops, task-run changes and return/reset cleanup', t => {
  const original = concurrentMission(t), id = original.drones[0]!.id;
  for (const policy of ['stop', 'pause', 'continue']) {
    const c = config([id]); c.values.disconnect = policy;
    let m = startGpsAttack(original, c); m.drones[0]!.connectionStatus = 'DISCONNECTED';
    m = advanceGpsAttacks(m, 1);
    if (policy === 'stop') assert.equal(m.drones[0]!.gpsAttack, undefined);
    else assert.equal(m.drones[0]!.gpsAttack!.phase, policy === 'pause' ? 'paused' : 'active');
  }
  let m = startGpsAttack(original, config([id])); m.drones[0]!.assignedTaskId = 'next-run';
  assert.equal(advanceGpsAttacks(m, .2).drones[0]!.gpsAttack, undefined);
  m = startGpsAttack(original, config([id])); m.drones[0]!.position.z = 600;
  assert.equal(advanceGpsAttacks(m, .2).drones[0]!.gpsAttack, undefined);
  assert.ok(state().startGpsAttack(config([id])));
  state().returnDrone(id); assert.equal(state().missionState.drones[0]!.gpsAttack, undefined);
  state().reset(); assert.ok(state().missionState.drones.every(d => !d.gpsAttack && !d.trajectory.length));
});

test('an attack on one task leaves all other concurrently running tasks unchanged', t => {
  const original = concurrentMission(t), targets = original.groups[0]!.drones;
  const baseline = advance(original, 25), attacked = advance(startGpsAttack(original, config(targets)), 25);
  for (const d of attacked.drones.filter(d => !targets.includes(d.id))) {
    assert.deepEqual(d.position, baseline.drones.find(n => n.id === d.id)!.position);
    assert.equal(d.gpsAttack, undefined);
  }
  for (let i = 1; i < 5; i++) assert.deepEqual(attacked.groups[i], baseline.groups[i]);
});

test('queued rescue aircraft stays grounded until recon confirmation, then uses its own GPS disturbance', t => {
  const original = concurrentMission(t), group = original.groups[4]!;
  const rescue = original.drones.find(d => group.drones.includes(d.id) && d.instanceStatus === 'STANDBY')!;
  assert.ok(rescue);
  const attacked = startGpsAttack(original, config([rescue.id]));
  const waiting = advance(attacked, 5).drones.find(d => d.id === rescue.id)!;
  assert.deepEqual(waiting.position, rescue.position);
  assert.ok(waiting.gpsAttack);
  // Model the existing human confirmation event; launch remains owned by the task simulator.
  attacked.groups[4] = { ...group, execution: { ...group.execution!, reconConfirmed: true }, lifecycle: '执行中' };
  const clean = stopGpsAttack(attacked);
  const normal = advance(clean, 10).drones.find(d => d.id === rescue.id)!;
  const affected = advance(attacked, 10).drones.find(d => d.id === rescue.id)!;
  assert.equal(affected.instanceStatus, 'FLYING');
  assert.ok(Math.hypot(affected.position.x - normal.position.x, affected.position.y - normal.position.y) > .1);
  assert.ok(affected.trajectory.some(p => p.gpsAttackId));
});

test('task termination archives red trail history and does not terminate attacks in another task', t => {
  const original = concurrentMission(t), first = original.groups[0]!, second = original.groups[1]!;
  assert.ok(state().startGpsAttack(config([...first.drones, ...second.drones])));
  t.mock.timers.tick(2000);
  state().selectTaskGroup(first.id); state().terminateExecution();
  assert.ok(state().missionState.drones.filter(d => first.drones.includes(d.id)).every(d => !d.gpsAttack));
  assert.ok(state().missionState.drones.filter(d => second.drones.includes(d.id)).every(d => d.gpsAttack));
  for (let i = 0; i < 400 && !state().records.some(r => r.groupId === first.id); i++) t.mock.timers.tick(200);
  const record = state().records.find(r => r.groupId === first.id)!;
  assert.ok(record);
  assert.ok(record.drones.some(d => d.trajectory.some(p => p.gpsAttackId)));
  assert.ok(record.drones.every(d => !d.gpsAttack));
  assert.ok(record.events.some(e => e.title === 'GPS 欺骗启动'));
});

test('waiting for human confirmation still holds using GPS feedback; stopping recovers toward planned hold point', t => {
  const mission = concurrentMission(t), g = mission.groups[3]!, id = g.drones[0]!;
  const target = g.plan!.routes.find(r => r.droneId === id)!.waypoints.at(-1)!;
  g.lifecycle = '待结果确认';
  const drone = mission.drones.find(d => d.id === id)!;
  drone.position = { ...target }; drone.velocity = { x: 0, y: 0, z: 0 };
  const attacked = advance(startGpsAttack(mission, config([id])), 30);
  const distance = (m: Mission) => { const d = m.drones.find(d => d.id === id)!; return Math.hypot(d.position.x - target.x, d.position.y - target.y); };
  assert.ok(distance(attacked) > 5);
  const recovered = advance(stopGpsAttack(attacked), 40);
  assert.ok(distance(recovered) < distance(attacked));
  assert.equal(recovered.groups[3]!.lifecycle, '待结果确认');
});


test('one cross-task batch uses individual offsets, modes, strength, delays and expiry snapshots', t => {
  const original = concurrentMission(t);
  const ids = original.groups.slice(0, 3).map(g => original.drones.find(d => g.drones.includes(d.id) && d.instanceStatus === 'FLYING')!.id);
  const c = config(ids);
  c.droneConfigs = {
    [ids[0]!]: { severity: 'high', values: { ...c.values, offsetX: -20, offsetY: 0, duration: 2 } },
    [ids[1]!]: { severity: 'low', values: { ...c.values, offsetX: 40, offsetY: 0, delay: 1, mode: 'gradual', ramp: 2, duration: 10 } },
    [ids[2]!]: { severity: 'high', values: { ...c.values, mode: 'path', waypoints: '0,0,0\n0,20,0', duration: 10 } },
  };
  const started = startGpsAttack(original, c);
  c.droneConfigs[ids[0]!]!.values.offsetX = 80;
  let m = advanceGpsAttacks(started, .5);
  const attack = (id: string) => m.drones.find(d => d.id === id)!.gpsAttack;
  assert.equal(attack(ids[0]!)!.offset.x, -20);
  assert.equal(attack(ids[1]!)!.phase, 'delayed');
  assert.equal(attack(ids[2]!)!.offset.x, 0); assert.ok(attack(ids[2]!)!.offset.y > 0);
  m = advanceGpsAttacks(m, 1.5);
  assert.equal(attack(ids[0]!), undefined);
  assert.equal(attack(ids[1]!)!.offset.x, 7);
  assert.equal(attack(ids[2]!)!.offset.y, 4);
  assert.deepEqual(attack(ids[1]!)!.config.targetDroneIds, [ids[1]]);
  c.droneConfigs[ids[1]!]!.values.duration = 0;
  assert.throws(() => startGpsAttack(original, c), new RegExp(ids[1]!));
  assert.ok(original.drones.every(d => !d.gpsAttack));
});
