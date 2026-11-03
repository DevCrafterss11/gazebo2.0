import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { useCollaborationStore as store } from '../src/stores/collaborationStore';
import { applyFlightCommand } from '../src/services/mock/CollaborationFlightSimulator';
import { advanceMission } from '../src/services/mock/CollaborationMockRuntime';
import { flightStateLabel } from '../src/domain/collaborationFlight';
import type { FlightCommand } from '../src/types/collaboration';
const s=()=>store.getState();
const drone=(id='uav101')=>s().missionState.drones.find(d=>d.id===id)!;
function setup(t:TestContext) {
 s().reset();t.mock.timers.enable({apis:['setInterval','Date']});t.after(()=>{s().reset();t.mock.timers.reset();});
 s().enterSimulation();s().startCluster();t.mock.timers.tick(2000);assert.ok(s().clusterRunning);
}
function command(t:TestContext,c:FlightCommand,id='uav101',accepted=true) {
 s().sendFlightCommand(id,c);assert.equal(s().flightCommands.at(-1)!.status,'pending');
 t.mock.timers.tick(200);assert.equal(s().flightCommands.at(-1)!.status,accepted?'accepted':'rejected',s().flightCommands.at(-1)!.detail);
}
function until(t:TestContext,fn:()=>boolean,seconds=180) {for(let i=0;i<seconds*5&&!fn();i++)t.mock.timers.tick(200);assert.ok(fn(),'flight condition timed out');}
function takeoff(t:TestContext) {command(t,{type:'mode',mode:'GUIDED'});command(t,{type:'arm'});command(t,{type:'takeoff',altitude:15});until(t,()=>drone().flightControl?.phase==='hold');}

test('idle telemetry keeps pushing at 5 Hz without fabricating ground motion',t=>{
 setup(t);const before=structuredClone(drone());t.mock.timers.tick(1000);assert.ok(drone().updatedAt>before.updatedAt);assert.deepEqual(drone().position,before.position);assert.deepEqual(drone().attitude,[0,0,0]);assert.equal(drone().trajectory.length,0);
});
test('commands wait for runtime ACK; duplicate pending requests are blocked',t=>{
 setup(t);s().sendFlightCommand('uav101',{type:'mode',mode:'GUIDED'});assert.equal(drone().mode,'待命');s().sendFlightCommand('uav101',{type:'arm'});assert.equal(s().flightCommands.length,1);t.mock.timers.tick(200);assert.equal(drone().mode,'GUIDED');assert.equal(drone().armed,false);
});
test('takeoff requires mode and arm; invalid height never launches',t=>{
 setup(t);command(t,{type:'takeoff',altitude:15},'uav101',false);command(t,{type:'mode',mode:'LOITER'});command(t,{type:'arm'});command(t,{type:'takeoff',altitude:15},'uav101',false);command(t,{type:'mode',mode:'GUIDED'});command(t,{type:'takeoff',altitude:NaN},'uav101',false);command(t,{type:'takeoff',altitude:121},'uav101',false);assert.equal(drone().position.z,0);
});
test('takeoff climbs progressively, other aircraft remain grounded; hover attitude and battery update',t=>{
 setup(t);const others=s().missionState.drones.slice(1).map(d=>({...d.position}));command(t,{type:'mode',mode:'GUIDED'});command(t,{type:'arm'});command(t,{type:'takeoff',altitude:15});assert.ok(drone().position.z<15);until(t,()=>drone().flightControl?.phase==='hold');assert.ok(Math.abs(drone().position.z-15)<.08);
 const first=structuredClone(drone());t.mock.timers.tick(1000);assert.notDeepEqual(drone().attitude,first.attitude);assert.ok(drone().battery<first.battery);assert.deepEqual(s().missionState.drones.slice(1).map(d=>d.position),others);command(t,{type:'disarm'},'uav101',false);
});
test('relative 5m motion reaches real metric endpoint and records track; shortest yaw turn and rotated forward',t=>{
 setup(t);takeoff(t);const home={...drone().position};command(t,{type:'move',direction:'forward',distance:5});until(t,()=>drone().flightControl?.phase==='hold');assert.ok(Math.abs(drone().position.y-home.y-5)<.08);assert.ok(drone().trajectory.length>5);
 command(t,{type:'yaw',degrees:90});until(t,()=>Math.abs(drone().attitude[2]-90)<.01);const p={...drone().position};command(t,{type:'move',direction:'forward',distance:5});until(t,()=>drone().flightControl?.phase==='hold');assert.ok(Math.abs(drone().position.x-p.x-5)<.08);assert.ok(Math.abs(drone().position.y-p.y)<.08);
});
test('all relative axes and coordinate goto are executable with boundaries',t=>{
 setup(t);takeoff(t);for(const direction of ['back','left','right','up','down'] as const){command(t,{type:'move',direction,distance:5});until(t,()=>drone().flightControl?.phase==='hold');}
 command(t,{type:'goto',target:{x:30,y:25,z:20}});until(t,()=>drone().flightControl?.phase==='hold');assert.ok(Math.hypot(drone().position.x-30,drone().position.y-25,drone().position.z-20)<.1);
 command(t,{type:'goto',target:{x:30,y:25,z:-1}},'uav101',false);command(t,{type:'move',direction:'up',distance:51},'uav101',false);command(t,{type:'yaw',degrees:NaN},'uav101',false);
});
test('manual route upload does not launch; AUTO visits each waypoint then holds; RTL lands at own home',t=>{
 setup(t);const home={...drone().homePosition};const route=[{x:home.x,y:home.y+10,z:15},{x:home.x+10,y:home.y+10,z:15},{x:home.x+10,y:home.y,z:15}];
 command(t,{type:'upload',waypoints:route});assert.equal(drone().armed,false);assert.equal(drone().trajectory.length,0);command(t,{type:'mode',mode:'AUTO'},'uav101',false);takeoff(t);command(t,{type:'upload',waypoints:route},'uav101',false);command(t,{type:'mode',mode:'AUTO'});
 until(t,()=>drone().flightControl?.phase==='hold');assert.equal(drone().flightControl?.waypoint,2);assert.ok(Math.hypot(drone().position.x-route[2]!.x,drone().position.y-route[2]!.y)<.1);assert.ok(route.every(p=>drone().trajectory.some(q=>Math.hypot(q.x-p.x,q.y-p.y,q.z-p.z)<.5)));
 command(t,{type:'return'});until(t,()=>!drone().armed);assert.deepEqual(drone().position,home);assert.equal(drone().instanceStatus,'STANDBY');assert.ok(drone().returnTrajectory.length>5);
});
test('LAND descends at current location and automatically disarms',t=>{
 setup(t);takeoff(t);command(t,{type:'goto',target:{x:20,y:25,z:15}});until(t,()=>drone().flightControl?.phase==='hold');const p={...drone().position};command(t,{type:'land'});assert.ok(drone().position.z>0);until(t,()=>!drone().armed);assert.equal(drone().position.x,p.x);assert.equal(drone().position.y,p.y);assert.equal(drone().position.z,drone().homePosition.z);
});
test('malformed and excessive routes rejected without replacing last uploaded route',t=>{
 setup(t);for(const waypoints of [[],[{x:0,y:0,z:10}],[{x:0,y:0,z:10},{x:NaN,y:3,z:10}],[{x:0,y:0,z:10},{x:1001,y:0,z:10}]])command(t,{type:'upload',waypoints},'uav101',false);assert.equal(drone().flightControl,undefined);
});
test('ACK checks latest state, rejects disconnected, unavailable and low battery resources',t=>{
 setup(t);for(const patch of [{connectionStatus:'DISCONNECTED' as const},{available:false},{battery:10}]){
  const m=structuredClone(s().missionState);Object.assign(m.drones[0]!,patch);assert.equal(applyFlightCommand(m,'uav101',{type:'arm'}).accepted,false);
 }
 s().sendFlightCommand('uav101',{type:'arm'});store.setState(state=>({missionState:{...state.missionState,drones:state.missionState.drones.map(d=>d.id==='uav101'?{...d,available:false}:d)}}));t.mock.timers.tick(200);assert.equal(s().flightCommands.at(-1)!.status,'rejected');assert.equal(drone().armed,false);
});
test('task-reserved drone rejects manual takeover while another free drone can fly',t=>{
 setup(t);s().selectTaskGroup('group-1');s().loadTaskExample();assert.ok(s().generateTaskPlan());assert.ok(s().prepareTask());assert.ok(s().distributeTask());command(t,{type:'mode',mode:'GUIDED'},'uav101',false);assert.ok(s().armTask());assert.ok(s().startExecution());
 command(t,{type:'mode',mode:'GUIDED'},'uav115');command(t,{type:'arm'},'uav115');command(t,{type:'takeoff',altitude:10},'uav115');t.mock.timers.tick(2000);const z=drone('uav115').position.z;s().pauseExecution();t.mock.timers.tick(2000);assert.ok(drone('uav115').position.z>z);assert.equal(s().isPaused,true);
});
test('manual low battery autonomously returns using same telemetry and does not stay armed',t=>{
 setup(t);takeoff(t);const m=structuredClone(s().missionState);m.drones[0]!.battery=19;let next=advanceMission(m,false,.2);assert.equal(next.drones[0]!.mode,'RTL');for(let i=0;i<400&&next.drones[0]!.armed;i++)next=advanceMission(next,false,.2);assert.equal(next.drones[0]!.armed,false);assert.deepEqual(next.drones[0]!.position,next.drones[0]!.homePosition);
});
test('cluster stop cancels pending controls and waits for manual aircraft landing; reset cancels clock',t=>{
 setup(t);takeoff(t);s().sendFlightCommand('uav102',{type:'arm'});s().stopCluster();assert.equal(s().flightCommands.at(-1)!.status,'rejected');until(t,()=>!s().clusterRunning);assert.ok(s().missionState.drones.every(d=>!d.armed&&d.instanceStatus==='STOPPED'));s().reset();t.mock.timers.tick(5000);assert.equal(s().flightCommands.length,0);assert.equal(s().events.length,0);
});

test('initial arm prepares GUIDED so takeoff is available after its ACK',t=>{
 setup(t);assert.equal(drone().mode,'待命');command(t,{type:'arm'});assert.equal(drone().mode,'GUIDED');assert.match(s().flightCommands.at(-1)!.detail,/GUIDED/);assert.equal(drone().position.z,0);
 command(t,{type:'takeoff',altitude:12});until(t,()=>drone().flightControl?.phase==='hold');assert.ok(Math.abs(drone().position.z-12)<.08);
});
test('LAND interrupts RTL and lands at the current XY instead of resuming return',t=>{
 setup(t);takeoff(t);command(t,{type:'goto',target:{x:45,y:30,z:15}});until(t,()=>drone().flightControl?.phase==='hold');command(t,{type:'return'});t.mock.timers.tick(600);const p={...drone().position};command(t,{type:'land'});assert.equal(drone().flightControl?.phase,'landing');assert.equal(drone().instanceStatus,'FLYING');const landing={...drone().position};until(t,()=>!drone().armed);assert.equal(drone().position.x,landing.x);assert.equal(drone().position.y,landing.y);assert.ok(Math.hypot(drone().position.x-drone().homePosition.x,drone().position.y-drone().homePosition.y)>10);assert.ok(drone().position.z<p.z);
});
test('explicit hover interrupts RTL, and LAND mode can still descend',t=>{
 setup(t);takeoff(t);command(t,{type:'goto',target:{x:35,y:25,z:15}});until(t,()=>drone().flightControl?.phase==='hold');command(t,{type:'return'});command(t,{type:'hold'});assert.equal(drone().instanceStatus,'FLYING');const p={...drone().position};t.mock.timers.tick(1000);assert.deepEqual(drone().position,p);assert.equal(drone().flightControl?.phase,'hold');command(t,{type:'return'});command(t,{type:'mode',mode:'LAND'});until(t,()=>!drone().armed);assert.ok(Math.hypot(drone().position.x-drone().homePosition.x,drone().position.y-drone().homePosition.y)>10);
});
test('ground low battery disarms in place without accidental automatic takeoff',t=>{
 setup(t);command(t,{type:'arm'});const m=structuredClone(s().missionState);m.drones[0]!.battery=19;m.drones[0]!.position.x+=20;const p={...m.drones[0]!.position};let next=advanceMission(m,false,.2);for(let i=0;i<20;i++)next=advanceMission(next,false,.2);assert.equal(next.drones[0]!.armed,false);assert.deepEqual(next.drones[0]!.position,p);assert.equal(next.drones[0]!.flightControl?.phase,'ground');
});
test('low battery RTL cannot be silently cancelled by hover',t=>{
 setup(t);takeoff(t);const m=structuredClone(s().missionState);m.drones[0]!.battery=19;const next=advanceMission(m,false,.2);assert.equal(next.drones[0]!.mode,'RTL');const rejected=applyFlightCommand(next,'uav101',{type:'hold'});assert.equal(rejected.accepted,false);assert.match(rejected.detail,/低电量/);
});

test('flight status prioritizes stopped, fault and lost telemetry over retained flight phase',t=>{
 setup(t);takeoff(t);assert.equal(flightStateLabel(drone()),'悬停');assert.equal(flightStateLabel({...drone(),connectionStatus:'DISCONNECTED'}),'通信中断');assert.equal(flightStateLabel({...drone(),connectionStatus:'STALE'}),'遥测过期');assert.equal(flightStateLabel({...drone(),instanceStatus:'FAULT'}),'故障');assert.equal(flightStateLabel({...drone(),instanceStatus:'STOPPED'}),'未启动');
});
