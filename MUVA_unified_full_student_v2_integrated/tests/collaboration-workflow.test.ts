import { assignmentEligibility, validateTask } from '../src/domain/collaborationMission';
import { captureCollaborationPreferences, restoreCollaborationPreferences, saveCollaborationPreferences } from '../src/services/preferences/collaborationPreferences';
import { services } from '../src/services/serviceRegistry';
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { automaticCoverageHeading, coverageRoutes, insidePolygon, partitionCoverage, planFingerprint, segmentInside, validPlanningPolygon } from '../src/domain/collaborationPlanning';
import { useCollaborationStore as store } from '../src/stores/collaborationStore';
import { taskTypeNames, type Position, type SimulationScenario } from '../src/types/collaboration';
import { seatsFor } from '../src/domain/collaborationResources';
import { collaborationPreferencesKey, legacyPreferencesKey } from '../src/services/preferences/collaborationPreferences';
const fits = (index:number) => s().missionState.drones.filter(d=>seatsFor(d,taskTypeNames[index]!).length>0).map(d=>d.id);
const s=()=>store.getState();
function setup(t:TestContext,index:number,scenario:SimulationScenario='success') {
  s().reset();t.mock.timers.enable({apis:['setInterval','Date']});t.after(()=>{s().reset();t.mock.timers.reset();});
  s().enterSimulation();s().startCluster();t.mock.timers.tick(2000);
  s().setBusinessView(`group-${index+1}`);s().loadTaskExample();s().updateGroupConfig(s().selectedTaskGroup,{scenario});
  assert.ok(s().generateTaskPlan(),s().notice);
}
function launch() {
  assert.ok(s().prepareTask(),s().notice);assert.ok(s().distributeTask(),s().notice);assert.ok(s().armTask(),s().notice);assert.ok(s().startExecution(),s().notice);
}
function finish(t:TestContext,maxSeconds=600,accept=true) {
  for(let i=0;i<maxSeconds*5&&s().isRunning;i++) {
    const g=s().missionState.groups.find(g=>g.id===s().activeGroupId);
    if(g?.lifecycle==='待结果确认') s().confirmTaskResult(accept);
    t.mock.timers.tick(200);
  }
  assert.equal(s().isRunning,false,`must safely finish: ${JSON.stringify(s().missionState.groups.find(g=>g.id===s().selectedTaskGroup))}`);
}
for(let i=0;i<5;i++) {
  test(`${taskTypeNames[i]}: complete planned deployment, execution, confirmation, RTL, success record`,t=>{
    setup(t,i);const members=s().missionState.groups[i]!.drones;const unselected=s().missionState.drones.filter(d=>!members.includes(d.id)).map(d=>structuredClone(d.position));launch();finish(t);
    const record=s().records[0]!;assert.equal(record.type,taskTypeNames[i]);assert.equal(record.group.outcome,'success');assert.equal(record.group.lifecycle,'已完成');assert.equal(record.group.progress,100);
    assert.equal(record.group.plan!.routes.length,3);assert.ok(record.events.some(e=>e.title==='模拟航线下发成功'));
    assert.ok(record.drones.every(d=>!d.armed&&!d.assignedTaskId&&d.instanceStatus==='STANDBY'));
    assert.ok(s().missionState.drones.every(d=>!d.armed&&!d.assignedTaskId));
    assert.deepEqual(s().missionState.drones.filter(d=>!members.includes(d.id)).map(d=>d.position),unselected);
    assert.equal(s().missionState.groups.filter(g=>g.runId).length,1);
    if(i===2) {assert.equal(record.group.execution!.handovers,2);assert.ok(record.group.execution!.aircraft.every(a=>a.dwell>=8));assert.equal(record.group.execution!.gapSeconds,0);}
    if(i===4) {assert.ok(record.group.execution!.reconConfirmed);assert.ok(record.events.some(e=>e.title==='模拟侦察确认'));}
  });
  test(`${taskTypeNames[i]}: deterministic execution failure returns all aircraft and archives reason`,t=>{
    setup(t,i,'execution-failure');launch();finish(t);const r=s().records[0]!;
    assert.equal(r.group.outcome,'failure');assert.equal(r.group.lifecycle,'已失败');assert.match(r.group.failureReason!,/执行故障/);assert.equal(r.evaluation.failedGroups,1);assert.equal(s().clusterRunning,true);
  });
  test(`${taskTypeNames[i]}: negative result is not silently counted as success`,t=>{
    setup(t,i,'negative-result');launch();finish(t);assert.equal(s().records[0]!.group.outcome,'failure');assert.ok(s().records[0]!.group.failureReason);assert.equal(s().records[0]!.evaluation.completedGroups,0);
  });
}
test('stages cannot be skipped; failed upload never arms or starts; cancellation releases reservations',t=>{
  setup(t,0,'upload-failure');assert.equal(s().startExecution(),false);assert.equal(s().armTask(),false);
  assert.ok(s().prepareTask());assert.equal(s().distributeTask(),false);assert.equal(s().armTask(),false);assert.equal(s().startExecution(),false);
  assert.ok(s().missionState.drones.every(d=>!d.armed&&!d.assignedTaskId));
  s().cancelTaskPreparation();s().updateGroupConfig('group-1',{scenario:'success'});assert.ok(s().generateTaskPlan());assert.ok(s().prepareTask());assert.ok(s().distributeTask());assert.ok(s().armTask());
  assert.equal(s().missionState.drones.filter(d=>d.armed).length,3);s().cancelTaskPreparation();assert.ok(s().missionState.drones.every(d=>!d.armed&&!d.assignedTaskId));assert.equal(s().isRunning,false);
});
test('geometry, parameters, queue order and member edits invalidate the previous plan and disarm',t=>{
  setup(t,2);assert.ok(s().prepareTask());assert.ok(s().distributeTask());assert.ok(s().armTask());
  s().reorderTaskDrone('uav102',-1);const g=s().missionState.groups[2]!;assert.equal(g.plan,undefined);assert.equal(g.drones[0],'uav102');assert.ok(s().missionState.drones.every(d=>!d.armed&&!d.assignedTaskId));
  assert.equal(s().prepareTask(),false);assert.ok(s().generateTaskPlan());const p=s().missionState.groups[2]!.plan!;assert.equal(p.fingerprint,planFingerprint(s().missionState,s().missionState.groups[2]!));
});
test('relay dwell starts at arrival, replacement flies from Home, sequential mode records real gap',t=>{
  setup(t,2);s().updateGroupConfig('group-3',{handover:'到点交接',duration:5});assert.ok(s().generateTaskPlan());launch();
  t.mock.timers.tick(1000);let g=s().missionState.groups[2]!;
  assert.ok(g.execution!.aircraft.every(a=>a.dwell===0));assert.equal(s().missionState.drones[1]!.instanceStatus,'STANDBY');
  finish(t);g=s().records[0]!.group;assert.ok(g.execution!.gapSeconds>0);assert.ok(g.execution!.aircraft[1]!.launchedAt!+1e-6>=g.execution!.aircraft[0]!.arrivedAt!+5);
  assert.ok(s().records[0]!.drones.every(d=>d.trajectory[0]!.z===0));
});
test('rejecting recon never launches dependent aircraft, but archives failed result safely',t=>{
  setup(t,4);launch();finish(t,300,false);const r=s().records[0]!;assert.equal(r.group.outcome,'failure');
  const rescue=r.group.plan!.routes.find(r=>r.dependsOn)!;assert.equal(r.group.execution!.aircraft.find(a=>a.droneId===rescue.droneId)!.launchedAt,undefined);assert.match(r.group.failureReason!,/侦察/);
});
test('drawn concave polygons produce clipped coverage and interior connecting paths for each aircraft',()=>{
  const polygon:Position[]=[[0,0],[100,0],[100,100],[70,100],[70,25],[30,25],[30,100],[0,100]].map(([x,y])=>({x:x!,y:y!,z:20}));
  assert.ok(validPlanningPolygon(polygon));
  for(const heading of [0,35,90,153]) {
    const routes=coverageRoutes(polygon,8,3,heading);assert.equal(routes.length,3);
    for(const route of routes) {assert.ok(route.length>=2);assert.ok(route.every(p=>insidePolygon(p,polygon)));assert.ok(route.slice(1).every((p,i)=>segmentInside(route[i]!,p,polygon)),`outside connector at heading ${heading}`);}
  }
  assert.equal(validPlanningPolygon([[0,0],[10,10],[0,10],[10,0]].map(([x,y])=>({x:x!,y:y!,z:0}))),false);
});
test('open polygon cannot be planned and dragging an invalid polygon does not bypass validation',t=>{
  setup(t,0);s().clearMapPoints();for(const [x,y] of [[0,0],[50,0],[50,40],[0,40]]) s().addMapPoint({x:x!,y:y!,z:20,kind:'point'});
  assert.equal(s().generateTaskPlan(),false);assert.ok(s().closeTaskArea());assert.ok(s().generateTaskPlan());
  s().updateMapPoint(1,{x:0,y:40,z:20,kind:'point'});assert.equal(s().generateTaskPlan(),false);
});

test('dual search confirmation succeeds only with two distinct simulated aircraft receipts',t=>{
  setup(t,1);s().updateGroupConfig('group-2',{confirmation:'双机确认'});assert.ok(s().generateTaskPlan(),s().notice);launch();finish(t);
  const r=s().records[0]!;assert.equal(r.group.outcome,'success');assert.ok(new Set(r.group.execution!.confirmedBy).size>=2);
});
test('search relay is automatically placed inside the area at plan generation, never scans or confirms, and returns after search',t=>{
  setup(t,1);
  const group=s().missionState.groups[1]!, relay=group.plan!.routes.find(r=>r.role==='中继机')!;
  const polygon=group.points.filter(p=>p.kind==='point');
  assert.ok(relay);
  assert.equal(relay.waypoints.length,2);
  assert.ok(insidePolygon(relay.waypoints[1]!,polygon));
  assert.equal(group.plan!.regions!.some(r=>r.droneId===relay.droneId),false);
  assert.equal(group.plan!.regions!.length,group.drones.length-1);
  assert.deepEqual(group.plan!.routes.find(r=>r.droneId===relay.droneId)!.waypoints[1],relay.waypoints[1]);
  launch();
  for(let i=0;i<3000&&s().isRunning;i++) {
    t.mock.timers.tick(200);
    const active=s().missionState.groups[1]!;
    if(active.execution?.aircraft.find(a=>a.droneId===relay.droneId)?.completed && active.lifecycle==='执行中') {
      assert.equal(s().missionState.drones.find(d=>d.id===relay.droneId)!.instanceStatus,'FLYING');
      break;
    }
  }
  finish(t);
  const record=s().records[0]!;
  assert.equal(record.group.outcome,'success');
  assert.ok(!record.group.execution!.confirmedBy.includes(relay.droneId));
  assert.equal(record.drones.find(d=>d.id===relay.droneId)!.instanceStatus,'STANDBY');
});
test('a search relay cannot count as the second observing aircraft',t=>{
  setup(t,1);s().updateGroupConfig('group-2',{confirmation:'双机确认'});
  const group=s().missionState.groups[1]!;
  for(const id of group.drones.filter(id=>group.roles[id]==='协同机')) s().setTaskDrone(group.id,id,false);
  assert.match(validateTask(s().missionState,s().missionState.groups[1]!).join(' '),/双机确认还差 1 架观测机/);
  assert.equal(s().generateTaskPlan(),false);
});
test('rescue relay deploys ahead of the scout gate, then both confirmations and RTL finish without a stuck run',t=>{
  setup(t,4);
  s().updateGroupConfig('group-5',{strategy:'先侦察后救援'});
  assert.ok(s().generateTaskPlan(),s().notice);
  const group=s().missionState.groups[4]!;
  const relay=group.plan!.routes.find(r=>r.role==='中继机')!;
  const rescue=group.plan!.routes.find(r=>r.role==='救援机')!;
  assert.equal(relay.dependsOn,undefined);
  assert.equal(relay.stationSeconds,0);
  assert.ok(rescue.dependsOn);
  launch();
  let atRecon=false,atResult=false;
  for(let i=0;i<3000&&s().isRunning;i++) {
    t.mock.timers.tick(200);
    const current=s().missionState.groups[4]!;
    if(current.execution?.awaiting==='recon') {
      atRecon=true;
      assert.equal(current.execution.aircraft.find(a=>a.droneId===rescue.droneId)!.phase,'queued');
      assert.equal(current.execution.aircraft.find(a=>a.droneId===relay.droneId)!.completed,true);
      s().confirmTaskResult(true);
    } else if(current.execution?.awaiting==='result') {atResult=true;s().confirmTaskResult(true);}
  }
  assert.ok(atRecon&&atResult,'both confirmation gates were reached');
  assert.equal(s().isRunning,false);
  assert.equal(s().records[0]!.group.outcome,'success');
  assert.ok(s().records[0]!.drones.every(d=>d.instanceStatus==='STANDBY'));
});
test('clockwise perimeter planning allocates boundary sections even when aircraft outnumber vertices',t=>{
  setup(t,0);s().updateGroupConfig('group-1',{strategy:'顺时针巡逻'});
  for(const id of fits(0)) if(!s().missionState.groups[0]!.drones.includes(id)) s().setTaskDrone('group-1',id,true);
  const n=s().missionState.groups[0]!.drones.length;assert.equal(n,9,'all nine recon drones can join patrol');
  assert.ok(s().generateTaskPlan(),s().notice);const g=s().missionState.groups[0]!,polygon=g.points.filter(p=>p.kind==='point');
  assert.ok(n>polygon.length,'more aircraft than vertices');
  assert.equal(g.plan!.routes.length,n);assert.equal(new Set(g.plan!.routes.map(r=>r.waypoints[0]!.z)).size,n);
  for(const r of g.plan!.routes){assert.ok(r.waypoints.length>=3);assert.ok(r.waypoints.slice(1).every(p=>insidePolygon(p,polygon)));}
});
test('stopping cluster during armed deployment disarms ground reservations without a fabricated flight',t=>{
  setup(t,0);assert.ok(s().prepareTask());assert.ok(s().distributeTask());assert.ok(s().armTask());s().stopCluster();
  assert.equal(s().clusterRunning,false);assert.ok(s().missionState.drones.every(d=>!d.armed&&!d.assignedTaskId&&!d.trajectory.length));assert.equal(s().records.length,0);
});
test('paused low-battery aircraft trigger failed acceptance and safe simulated RTL rather than hovering indefinitely',t=>{
  setup(t,0);launch();t.mock.timers.tick(5000);s().pauseExecution();
  store.setState(state=>({missionState:{...state.missionState,drones:state.missionState.drones.map((d,i)=>i===0?{...d,battery:19}:d)}}));
  finish(t);const r=s().records[0]!;assert.equal(r.group.outcome,'failure');assert.match(r.group.failureReason!,/20%/);assert.ok(r.group.execution!.aircraft.every(a=>a.phase==='done'));
});
test('replacement preflight failure never launches the queued monitoring aircraft',t=>{
  setup(t,2);s().updateGroupConfig('group-3',{handover:'到点交接'});assert.ok(s().generateTaskPlan());launch();
  store.setState(state=>({missionState:{...state.missionState,drones:state.missionState.drones.map((d,i)=>i===1?{...d,connectionStatus:'DISCONNECTED'}:d)}}));
  finish(t);const r=s().records[0]!;assert.equal(r.group.outcome,'failure');assert.equal(r.group.execution!.aircraft[1]!.launchedAt,undefined);assert.match(r.group.failureReason!,/接替前检查失败/);
});

test('auto heading follows rotated rectangle long edge, clipped coverage remains inside', () => {
  const angle = 32 * Math.PI / 180;
  const polygon = [[0,0],[120,0],[120,40],[0,40]].map(([x,y]) => ({x:x!*Math.cos(angle)-y!*Math.sin(angle),y:x!*Math.sin(angle)+y!*Math.cos(angle),z:24}));
  const heading = automaticCoverageHeading(polygon);
  assert.ok(Math.abs(heading-32)<1e-6);
  const paths = coverageRoutes(polygon,8,3,heading);
  assert.equal(paths.length,3);
  assert.ok(paths.every(path=>path.length>=2&&path.slice(1).every((p,i)=>segmentInside(path[i]!,p,polygon))));
});
test('selected aircraft determine equal-area coverage regions, confined serpentine routes and waypoint counts', () => {
  const p = [[-45,-30],[50,-30],[50,40],[-45,40]].map(([x,y])=>({x:x!,y:y!,z:24}));
  for(const count of [2,3,5,10,15]) {
    const ids=Array.from({length:count},(_,i)=>`uav${101+i}`);
    const plan=partitionCoverage(p,12,ids,0);
    assert.equal(plan.regions.length,count);assert.equal(plan.routes.length,count);
    assert.deepEqual(plan.regions.map(r=>r.droneId),ids);
    const total=plan.regions.reduce((sum,r)=>sum+r.area,0);
    assert.ok(Math.abs(total-95*70)<.001);
    for(let i=0;i<count;i++) {
      const region=plan.regions[i]!,route=plan.routes[i]!;
      assert.ok(Math.abs(region.area-total/count)<.001);
      assert.ok(route.length>=2);
      assert.ok(route.every(point=>insidePolygon(point,region.polygon)));
      assert.ok(route.slice(1).every((point,j)=>segmentInside(route[j]!,point,region.polygon)));
    }
  }
});
test('each aircraft receives its own alternating scan lanes rather than a shared full-area route', () => {
  const boundary = [[-60,-60],[60,-60],[60,60],[-60,60]].map(([x,y])=>({x:x!,y:y!,z:24}));
  const {regions,routes}=partitionCoverage(boundary,10,['uav101','uav102','uav103'],0);
  assert.equal(regions.length,3);
  routes.forEach((route,i)=>{
    // A 40 m high band yields at least four 120 m scan legs, alternating east/west.
    const legs=route.slice(0,-1).map((p,j)=>({a:p,b:route[j+1]!})).filter(({a,b})=>Math.abs(a.y-b.y)<.001 && Math.abs(a.x-b.x)>100);
    assert.ok(legs.length>=4,`region ${i+1} has multiple actual coverage passes`);
    assert.ok(legs.slice(1).every(({a,b},j)=>Math.sign(b.x-a.x)===-Math.sign(legs[j]!.b.x-legs[j]!.a.x)));
    assert.ok(legs.every(({a,b})=>insidePolygon(a,regions[i]!.polygon)&&insidePolygon(b,regions[i]!.polygon)));
  });
});
test('rotated and concave coverage assigns colored regions and stays inside the drawn boundary', () => {
  const angle=32*Math.PI/180;
  const rectangle=[[0,0],[120,0],[120,40],[0,40]].map(([x,y])=>({x:x!*Math.cos(angle)-y!*Math.sin(angle),y:x!*Math.sin(angle)+y!*Math.cos(angle),z:24}));
  const concave=[[0,0],[80,0],[80,50],[55,50],[55,25],[0,25]].map(([x,y])=>({x:x!,y:y!,z:24}));
  for(const [shape,heading] of [[rectangle,automaticCoverageHeading(rectangle)],[concave,0]] as const) {
    const result=partitionCoverage(shape,8,['uav101','uav102','uav103'],heading);
    assert.equal(result.regions.length,3);
    assert.ok(result.routes.every(route=>route.every(point=>insidePolygon(point,shape))));
  }
});
test('regenerating patrol/search plan after membership change updates area partitions and keeps other task logic independent',t=>{
  setup(t,0);assert.ok(s().generateTaskPlan(),s().notice);
  const first=s().missionState.groups[0]!.plan!;
  assert.equal(first.regions?.length,3);assert.equal(first.routes.length,3);
  const member=first.routes[2]!.droneId;s().assignDrone(member);
  assert.equal(s().missionState.groups[0]!.plan,undefined);
  assert.ok(s().generateTaskPlan(),s().notice);
  const updated=s().missionState.groups[0]!.plan!;
  assert.equal(updated.regions?.length,2);assert.equal(updated.routes.length,2);
  assert.equal(updated.regions?.some(r=>r.droneId===member),false);
});
test('search task partitions reflect its own selected aircraft without changing patrol',t=>{
  setup(t,1);assert.ok(s().generateTaskPlan(),s().notice);
  const group=s().missionState.groups[1]!;
  assert.equal(group.plan?.regions?.length,group.drones.filter(id=>group.roles[id]!=='中继机').length);
  assert.equal(group.plan?.routes.length,group.drones.length);
});
test('resource and task membership actions edit the same draft without changing the selected task', t => {
  s().reset();t.after(()=>s().reset());
  s().setTaskDrone('group-2','uav101',true);
  assert.equal(s().selectedTaskGroup,'group-1');
  s().setTaskDrone('group-1','uav101',true);
  s().assignDrone('uav101');
  assert.deepEqual(s().missionState.groups[0]!.drones,[]);
  assert.deepEqual(s().missionState.groups[0]!.roles,{});
  assert.deepEqual(s().missionState.groups[1]!.drones,['uav101']);
  assert.ok(s().missionState.drones.every(d=>!d.armed&&!d.assignedTaskId));
});
test('removing the primary member automatically promotes the next selected aircraft', t => {
  s().reset(); t.after(() => s().reset());
  for (const id of ['uav101', 'uav102']) s().setTaskDrone('group-1', id, true);
  assert.equal(s().missionState.groups[0]!.roles.uav101, '领航机');
  s().setTaskDrone('group-1', 'uav101', false);
  const group = s().missionState.groups[0]!;
  assert.deepEqual(group.drones, ['uav102']);
  assert.deepEqual(group.roles, { uav102: '领航机' });
});
test('rescue: a recon+camera drone never takes the rescue seat, so removing the rescuer leaves a visible gap instead of a wrong seat', t => {
  s().reset(); t.after(() => s().reset());
  s().updateGroupConfig('group-5',{strategy:'先侦察后救援'});
  // uav110 transport+dropper = rescuer; uav101 recon+camera = scout; uav113 relay = relay seat.
  for (const id of ['uav110', 'uav101', 'uav113']) s().setTaskDrone('group-5', id, true);
  assert.deepEqual(s().missionState.groups[4]!.roles, { uav110: '救援机', uav101: '侦察机', uav113: '中继机' });
  s().setTaskDrone('group-5', 'uav110', false);
  const group = s().missionState.groups[4]!;
  assert.deepEqual(group.drones, ['uav101', 'uav113']);
  assert.ok(!Object.values(group.roles).includes('救援机'), 'no one is silently promoted to a seat they cannot hold');
  assert.match(validateTask(s().missionState, group).join(' '), /至少需要一架救援机/);
});
test('先侦察后救援 without a scout is reported before planning, not only when the route is generated', t => {
  s().reset(); t.mock.timers.enable({apis:['setInterval','Date']}); t.after(() => { s().reset(); t.mock.timers.reset(); });
  s().enterSimulation(); s().startCluster(); t.mock.timers.tick(2000);
  s().selectTaskGroup('group-5');
  s().updateGroupConfig('group-5',{strategy:'先侦察后救援'});
  s().setTaskDrone('group-5','uav110',true);s().setTaskDrone('group-5','uav111',true);
  assert.match(validateTask(s().missionState,s().missionState.groups[4]!).join(' '),/还差 1 架侦察机/);
  // Adding a recon+camera drone clears exactly that gap.
  s().setTaskDrone('group-5','uav101',true);
  assert.doesNotMatch(validateTask(s().missionState,s().missionState.groups[4]!).join(' '),/侦察机/);
});
test('resource membership edit invalidates a prepared plan and releases its reservations', t => {
  setup(t,0);s().prepareTask();s().distributeTask();s().armTask();
  s().setTaskDrone('group-1','uav103',false);
  assert.equal(s().missionState.groups[0]!.plan,undefined);
  assert.ok(s().missionState.drones.every(d=>!d.armed&&!d.assignedTaskId));
});
test('two rectangle corners atomically replace geometry, close it and invalidate old plan', t => {
  setup(t,0);
  assert.ok(s().setRectangleArea({x:-60,y:-40,z:24,kind:'point'},{x:70,y:50,z:24,kind:'point'}));
  const g=s().missionState.groups[0]!;
  assert.equal(g.points.length,4);assert.equal(g.areaClosed,true);assert.equal(g.plan,undefined);
  assert.ok(s().generateTaskPlan());
  assert.equal(s().missionState.groups[0]!.plan!.area,11700);
  const before=s().missionState.groups[0]!.points;
  assert.equal(s().setRectangleArea({x:0,y:0,z:24,kind:'point'},{x:0,y:1,z:24,kind:'point'}),false);
  assert.equal(s().missionState.groups[0]!.points,before);
});
test('new task retains default aircraft and roles but does not reuse old geometry or receipts', t => {
  setup(t,0);const before=s().missionState.groups[0]!;s().newTask(false);const after=s().missionState.groups[0]!;
  assert.deepEqual(after.drones,before.drones);assert.deepEqual(after.roles,before.roles);
  assert.deepEqual(after.points,[]);assert.equal(after.plan,undefined);assert.equal(after.runId,null);
});

test('preference whitelist restores only configuration, never live flight or old mission data', t => {
  setup(t,0);const mission=structuredClone(s().missionState);
  mission.drones[0]!.armed=true;mission.drones[0]!.assignedTaskId='old-run';
  const saved=captureCollaborationPreferences(mission,s().arrayLayout);
  const text=JSON.stringify(saved);
  for(const forbidden of ['armed','position','trajectory','receipts','execution','scenario','points','runId']) assert.ok(!text.includes(`"${forbidden}"`),forbidden);
  const fresh = services.collaboration.createInitialMission();
  const restored=restoreCollaborationPreferences(fresh,s().arrayLayout,{getItem:()=>text,setItem:()=>{},removeItem:()=>{}});
  assert.deepEqual(restored.mission.groups[0]!.drones,mission.groups[0]!.drones);
  assert.deepEqual(restored.mission.groups[0]!.roles,mission.groups[0]!.roles);
  assert.ok(restored.mission.drones.every(d=>!d.armed&&!d.assignedTaskId&&d.connectionStatus==='DISCONNECTED'));
  assert.ok(restored.mission.groups.every(g=>!g.plan&&!g.runId&&!g.points.length));
});
test('corrupt or unavailable preference storage safely falls back; unknown IDs and roles are sanitized', () => {
  const mission=services.collaboration.createInitialMission(), layout={centerX:0,centerY:0,columnSpacing:5,rowSpacing:5,altitude:0};
  const fake=(text:string)=>({getItem:()=>text,setItem:()=>{},removeItem:()=>{}});
  for(const text of ['{bad','{"version":9}',JSON.stringify({version:1,resources:[],groups:[],arrayLayout:{...layout,columnSpacing:-1}})]) {
    const result=restoreCollaborationPreferences(mission,layout,fake(text));assert.equal(result.mission,mission);assert.match(result.status,/损坏/);
  }
  const saved=captureCollaborationPreferences(mission,layout);
  saved.groups[0]!.drones=['uav101','uav101','unknown'];saved.groups[0]!.roles={uav101:'非法角色'};
  const restored=restoreCollaborationPreferences(mission,layout,fake(JSON.stringify(saved)));
  assert.deepEqual(restored.mission.groups[0]!.drones,['uav101']);assert.notEqual(restored.mission.groups[0]!.roles.uav101,'非法角色');
  assert.equal(saveCollaborationPreferences(saved,{getItem:()=>null,setItem:()=>{throw new Error('quota');},removeItem:()=>{}}),false);
});
test('all five task templates keep independent memberships, order and roles across restore', t => {
  s().reset();t.after(()=>s().reset());
  const picks=[0,1,2,3,4].map(i=>pickOne(i));
  picks.forEach((id,i)=>s().setTaskDrone(`group-${i+1}`,id,true));
  const saved=captureCollaborationPreferences(s().missionState,s().arrayLayout);
  const restored=restoreCollaborationPreferences(services.collaboration.createInitialMission(),s().arrayLayout,{getItem:()=>JSON.stringify(saved),setItem:()=>{},removeItem:()=>{}});
  for(let i=0;i<5;i++) {
    assert.deepEqual(restored.mission.groups[i]!.drones,[picks[i]]);
    assert.deepEqual(restored.mission.groups[i]!.roles,s().missionState.groups[i]!.roles);
  }
  assert.equal(restored.migrated,false);
});
function pickOne(index:number){return fits(index)[0]!;}

test('type and payload gate membership with a readable reason, and survive preference restore', t => {
  s().reset(); t.after(() => s().reset());
  // Recon+camera cannot join transport; the notice names the seat requirement.
  s().setTaskDrone('group-4','uav101',true);
  assert.deepEqual(s().missionState.groups[3]!.drones,[]);
  assert.match(s().notice,/物资运输需要运输/);
  // Same type, wrong payload: transport+camera is refused with a payload reason.
  assert.ok(s().reconfigureDrone('uav110',{droneType:'运输',payload:'摄像头'}));
  s().setTaskDrone('group-4','uav110',true);
  assert.deepEqual(s().missionState.groups[3]!.drones,[]);
  assert.match(s().notice,/运输机需要抛投器，该机载荷是摄像头/);
  // Fixing the payload lets it in.
  assert.ok(s().reconfigureDrone('uav110',{droneType:'运输',payload:'抛投器'}));
  s().setTaskDrone('group-4','uav110',true);
  assert.deepEqual(s().missionState.groups[3]!.drones,['uav110']);
  const saved=captureCollaborationPreferences(s().missionState,s().arrayLayout);
  const restored=restoreCollaborationPreferences(services.collaboration.createInitialMission(),s().arrayLayout,{getItem:()=>JSON.stringify(saved),setItem:()=>{},removeItem:()=>{}});
  assert.equal(restored.mission.drones[9]!.droneType,'运输');assert.equal(restored.mission.drones[9]!.payload,'抛投器');
  assert.deepEqual(restored.mission.groups[3]!.drones,['uav110']);
});

test('reconfiguring a drone updates open drafts it no longer fits, leaves finished groups alone, and refuses while occupied', t => {
  s().reset(); t.after(() => s().reset());
  s().setTaskDrone('group-1','uav101',true);s().setTaskDrone('group-2','uav101',true);
  // recon -> relay: patrol has no relay seat so it leaves; search has a camera relay seat so it stays and moves to it.
  assert.ok(s().reconfigureDrone('uav101',{droneType:'中继',payload:'摄像头'}));
  assert.deepEqual(s().missionState.groups[0]!.drones,[]);
  assert.deepEqual(s().missionState.groups[1]!.drones,['uav101']);
  assert.equal(s().missionState.groups[1]!.roles.uav101,'中继机');
  // A finished group keeps its members and roles even if the drone no longer fits.
  s().setTaskDrone('group-1','uav102',true);
  store.setState(state=>({missionState:{...state.missionState,groups:state.missionState.groups.map((g,i)=>i===0?{...g,lifecycle:'已完成' as const}:g)}}));
  assert.ok(s().reconfigureDrone('uav102',{droneType:'运输',payload:'抛投器'}));
  assert.deepEqual(s().missionState.groups[0]!.drones,['uav102']);
  assert.equal(s().missionState.groups[0]!.roles.uav102,'领航机');
  // Unknown values are refused and nothing changes.
  const before=s().missionState.drones[2]!.droneType;
  assert.equal(s().reconfigureDrone('uav103',{droneType:'战斗' as never,payload:'摄像头'}),false);
  assert.equal(s().missionState.drones[2]!.droneType,before);
});

test('editResource is a whitelist: only map visibility changes, unknown keys never leak onto the drone', t => {
  s().reset(); t.after(() => s().reset());
  s().editResource('uav101',{visibleOnMap:false});
  assert.equal(s().missionState.drones[0]!.visibleOnMap,false);
  s().editResource('uav101',{droneType:'运输',payload:'抛投器'} as never);
  assert.equal(s().missionState.drones[0]!.droneType,'侦察');
  assert.equal(Object.keys(s().missionState.drones[0]!).includes('allowedTaskTypes'),false);
});

test('old v1 preferences migrate: loadout derived, members that no longer fit are dropped and named, hidden drones become visible, v2 is saved before v1 is removed', t => {
  s().reset(); t.after(() => s().reset());
  const mission=services.collaboration.createInitialMission();
  const legacy={version:1,arrayLayout:{centerX:0,centerY:0,columnSpacing:5,rowSpacing:5,altitude:0},
    resources:mission.drones.map((d,i)=>({id:d.id,enabled:true,visibleOnMap:i!==0,model:'Iris 四旋翼',components:[],allowedTaskTypes:i===3?['物资运输','应急救援']:[]})),
    groups:[{id:'group-1',drones:['uav101','uav104'],roles:{uav101:'领航机',uav104:'协同机'},mode:'SYNC'},{id:'group-4',drones:['uav104'],roles:{uav104:'运输机'},mode:'RELAY'}]};
  const store2=new Map<string,string>([[legacyPreferencesKey,JSON.stringify(legacy)]]);
  const storage={getItem:(k:string)=>store2.get(k)??null,setItem:(k:string,v:string)=>{store2.set(k,v)},removeItem:(k:string)=>{store2.delete(k)}};
  const restored=restoreCollaborationPreferences(mission,s().arrayLayout,storage);
  assert.equal(restored.migrated,true);
  // uav104 only did transport/rescue under v1 -> becomes a transport drone; so it leaves patrol but keeps transport.
  assert.equal(restored.mission.drones[3]!.droneType,'运输');
  assert.deepEqual(restored.mission.groups[0]!.drones,['uav101']);
  assert.deepEqual(restored.mission.groups[3]!.drones,['uav104']);
  assert.deepEqual(restored.dropped,['uav104 → 区域巡逻']);
  assert.match(restored.status,/uav104 → 区域巡逻/);
  assert.equal(restored.mission.drones[0]!.visibleOnMap,true,'a drone hidden under v1 must not stay invisible');
  // v1 is only removed after v2 is written.
  assert.equal(store2.has(collaborationPreferencesKey),false);
  assert.ok(saveCollaborationPreferences(captureCollaborationPreferences(restored.mission,restored.layout),storage));
  assert.equal(store2.has(collaborationPreferencesKey),true);assert.equal(store2.has(legacyPreferencesKey),false);
  // v2 present -> v1 ignored.
  store2.set(legacyPreferencesKey,'{"version":1,"broken":true}');
  assert.equal(restoreCollaborationPreferences(mission,s().arrayLayout,storage).migrated,false);
});
test('a failed v2 write keeps the old v1 data', () => {
  const kept=new Map<string,string>([[legacyPreferencesKey,'v1']]);
  const storage={getItem:(k:string)=>kept.get(k)??null,setItem:()=>{throw new Error('quota')},removeItem:(k:string)=>{kept.delete(k)}};
  const prefs=captureCollaborationPreferences(services.collaboration.createInitialMission(),{centerX:0,centerY:0,columnSpacing:5,rowSpacing:5,altitude:0});
  assert.equal(saveCollaborationPreferences(prefs,storage),false);assert.equal(kept.get(legacyPreferencesKey),'v1');
});
test('corrupt or foreign-version preferences fall back to defaults instead of throwing', () => {
  const mission=services.collaboration.createInitialMission(),layout={centerX:0,centerY:0,columnSpacing:5,rowSpacing:5,altitude:0};
  for(const text of ['{','null','{"version":9}','{"version":2,"resources":1,"groups":[],"arrayLayout":{}}']) {
    const r=restoreCollaborationPreferences(mission,layout,{getItem:(k:string)=>k===collaborationPreferencesKey?text:null,setItem:()=>{},removeItem:()=>{}});
    assert.equal(r.migrated,false);assert.equal(r.mission.drones.length,15);
  }
});

test('reconfiguring a drone in a planned draft invalidates the plan', t => {
  setup(t, 0);
  assert.ok(s().missionState.groups[0]!.plan);
  const member=s().missionState.groups[0]!.drones[0]!;
  // Same seat still fits (recon+camera -> recon+camera is a no-op); change payload so the seat is lost.
  assert.ok(s().reconfigureDrone(member,{droneType:'侦察',payload:'抛投器'}));
  assert.equal(s().missionState.groups[0]!.plan, undefined);
  assert.equal(s().missionState.groups[0]!.lifecycle, '配置中');
  assert.ok(!s().missionState.groups[0]!.drones.includes(member), 'a recon+dropper drone fits no patrol seat, so it leaves the draft');
});

test('equal-area bands whose height is an exact multiple of spacing get equal waypoint counts (no float-noise row flips)', () => {
  const rect = [[-60,-40],[60,-40],[60,40],[-60,40]].map(([x,y]) => ({x:x!,y:y!,z:24}));
  for (const [count, spacing] of [[2,10],[4,20],[4,10]] as const) {
    const ids = Array.from({length:count},(_,i)=>`uav${101+i}`);
    const { routes } = partitionCoverage(rect, spacing, ids, 0);
    assert.equal(new Set(routes.map(r=>r.length)).size, 1, `count=${count} spacing=${spacing}: ${routes.map(r=>r.length)}`);
  }
});
test('home-aware assignment never increases total take-off transit and keeps every region covered once', () => {
  const rect = [[-60,-40],[60,-40],[60,40],[-60,40]].map(([x,y]) => ({x:x!,y:y!,z:24}));
  const homes = [[-10,5],[-5,5],[0,5],[5,5]].map(([x,y]) => ({x:x!,y:y!,z:0}));
  const ids = ['uav101','uav102','uav103','uav104'];
  const transit = (plan: ReturnType<typeof partitionCoverage>) => plan.regions.reduce((sum, region, i) => {
    const home = homes[ids.indexOf(region.droneId)]!, start = plan.routes[i]![0]!;
    return sum + Math.hypot(home.x - start.x, home.y - start.y);
  }, 0);
  const plain = partitionCoverage(rect, 10, ids, 0), aware = partitionCoverage(rect, 10, ids, 0, homes);
  assert.ok(transit(aware) <= transit(plain) + 1e-6);
  assert.deepEqual([...aware.regions.map(r=>r.droneId)].sort(), ids);
  assert.deepEqual(aware.regions.map(r=>r.name), plain.regions.map(r=>r.name));
  assert.ok(aware.routes.every((route, i) => route.every(p => insidePolygon(p, aware.regions[i]!.polygon))));
});
