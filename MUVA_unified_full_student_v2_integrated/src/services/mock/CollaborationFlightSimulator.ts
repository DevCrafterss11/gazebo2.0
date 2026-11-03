import type { Drone, FlightCommand, FlightControl, Mission, Position } from '../../types/collaboration';
import { flightCommandIssue, flightCommandLabel } from '../../domain/collaborationFlight';
import { moveDrone } from './collaborationKinematics';

const distance = (a: Position, b: Position) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const clamp = (n: number, a: number, b: number) => Math.max(a,Math.min(b,n));
const wrap = (n: number) => (n % 360 + 360) % 360;
const control = (d: Drone): FlightControl => d.flightControl ?? { phase: 'ground', target: {...d.position}, route: [], waypoint: 0, heading: d.attitude[2], seconds: 0 };

export function applyFlightCommand(mission: Mission, droneId: string, command: FlightCommand): { mission: Mission; accepted: boolean; detail: string } {
  const d = mission.drones.find(d => d.id === droneId), issue = flightCommandIssue(d, command);
  if (!d || issue) return { mission, accepted: false, detail: issue || '无人机不存在' };
  let next: Drone = {...d,flightControl: structuredClone(control(d)), updatedAt: Date.now()};
  const c = next.flightControl!;
  const hover = () => {c.heading=d.attitude[2];c.target={...d.position};c.phase=d.position.z>d.homePosition.z+.15?'hold':'ground';next.instanceStatus=c.phase==='hold'?'FLYING':'STANDBY';next.status=c.phase==='hold'?'RUNNING':'READY';next.velocity={x:0,y:0,z:0};};
  const rtl = () => { if(d.position.z<=d.homePosition.z+.15&&d.instanceStatus!=='FLYING') {next.armed=false;c.phase='ground';next.mode='GUIDED';} else {c.phase='return';next.instanceStatus='RETURNING';next.mode='RTL';} };
  const land = () => {c.phase='landing';c.target={...d.position,z:d.homePosition.z};next.instanceStatus=d.position.z>d.homePosition.z+.15?'FLYING':'STANDBY';next.mode='LAND';};
  switch(command.type) {
    case 'mode':
      next.mode=command.mode;
      if(command.mode==='RTL') rtl(); else if(command.mode==='LAND') land();
      else if(command.mode==='AUTO') {c.phase='route';c.waypoint=0;c.target={...c.route[0]!};}
      else hover();
      break;
    case 'arm': next.armed=true;if(d.mode==='待命') next.mode='GUIDED';break;
    case 'disarm': next.armed=false;c.phase='ground';break;
    case 'upload': c.route=structuredClone(command.waypoints);c.waypoint=0;break;
    case 'takeoff':
      next.instanceStatus='FLYING';next.status='RUNNING';next.mode='GUIDED';c.phase='takeoff';c.target={...d.position,z:d.homePosition.z+command.altitude};
      next.trajectory=[{...d.position,timestamp:Date.now()}];next.returnTrajectory=[];break;
    case 'return': rtl();break;
    case 'land': land();break;
    case 'hold': hover();next.mode='LOITER';break;
    case 'goto': c.target={...command.target};c.phase='goto';next.mode='GUIDED';break;
    case 'move': {
      const angle=d.attitude[2]*Math.PI/180;
      const vector={forward:[Math.sin(angle),Math.cos(angle),0],back:[-Math.sin(angle),-Math.cos(angle),0],left:[-Math.cos(angle),Math.sin(angle),0],right:[Math.cos(angle),-Math.sin(angle),0],up:[0,0,1],down:[0,0,-1]}[command.direction]!;
      c.target={x:d.position.x+vector[0]!*command.distance,y:d.position.y+vector[1]!*command.distance,z:d.position.z+vector[2]!*command.distance};
      if(Math.abs(c.target.x)>1000||Math.abs(c.target.y)>1000||c.target.z<d.homePosition.z+1||c.target.z>d.homePosition.z+120) return {mission,accepted:false,detail:'相对移动超出教学空域或高度边界，请使用降落指令落地'};
      c.phase='goto';next.mode='GUIDED';break;
    }
    case 'yaw': hover();c.heading=wrap(d.attitude[2]+command.degrees);next.mode='GUIDED';break;
  }
  return {mission:{...mission,drones:mission.drones.map(item=>item.id===droneId?next:item)},accepted:true,detail:`模拟 ACK · ${flightCommandLabel(command)}已接收${command.type==='upload'?`，${command.waypoints.length} 个航点；尚未起飞`:command.type==='arm'&&d.mode==='待命'?'，模拟飞控已准备 GUIDED 模式，可设置高度起飞':''}`};
}

/** One telemetry source for controls, sidebar, markers, attitude and tracks. */
export function advanceFlightTelemetry(mission: Mission, dt: number): Mission {
  return {...mission,drones:mission.drones.map(d=>{
    if(d.connectionStatus!=='CONNECTED'||['STOPPED','STARTING','FAULT'].includes(d.instanceStatus)) return d;
    if(!d.flightControl) return {...d,updatedAt:Date.now()};
    const c={...d.flightControl,seconds:d.flightControl.seconds+dt};
    let next:Drone={...d,flightControl:c,updatedAt:Date.now()};
    if(d.armed&&d.battery<=20&&c.phase!=='landing'&&c.phase!=='return') {
      if(d.position.z>d.homePosition.z+.15||d.instanceStatus==='FLYING') {c.phase='return';next.mode='RTL';next.instanceStatus='RETURNING';}
      else {next.armed=false;c.phase='ground';next.mode='GUIDED';}
    }
    // Emergency RTL requested through task/resource actions uses this same flight controller.
    if(d.instanceStatus==='RETURNING') {c.phase='return';next.mode='RTL';}
    if(!d.armed||c.phase==='ground') {
      if(d.armed) next.battery=Math.max(0,d.battery-dt*100/(d.endurance*60)*.15);
      return {...next,velocity:{x:0,y:0,z:0},attitude:[0,0,d.attitude[2]]};
    }
    if(c.phase==='hold') {
      const turn=((c.heading-d.attitude[2]+540)%360)-180;
      next={...next,velocity:{x:0,y:0,z:0},battery:Math.max(0,d.battery-dt*100/(d.endurance*60)),attitude:[Math.sin(c.seconds*1.9)*.7,Math.cos(c.seconds*1.6)*.5,wrap(d.attitude[2]+clamp(turn,-45*dt,45*dt))]};
    } else {
      let target=c.target;
      if(c.phase==='return') {const atHome=Math.hypot(d.position.x-d.homePosition.x,d.position.y-d.homePosition.y)<.15;target={...d.homePosition,z:atHome?d.homePosition.z:Math.max(d.position.z,d.homePosition.z+2)};}
      const sample=moveDrone(next,target,dt,c.phase==='return'||c.phase==='landing',c.phase==='goto'?c.heading:undefined);
      next={...next,...sample};c.heading=sample.attitude[2];
      if(distance(sample.position,target)<.08) {
        if(c.phase==='return'||c.phase==='landing') {
          if(c.phase==='landing'||distance(sample.position,d.homePosition)<.08) {
            c.phase='ground';next={...next,position:{...target},armed:false,instanceStatus:'STANDBY',status:'READY',mode:'GUIDED',velocity:{x:0,y:0,z:0},attitude:[0,0,sample.attitude[2]]};
          }
        } else if(c.phase==='route'&&c.waypoint<c.route.length-1) {c.waypoint++;c.target={...c.route[c.waypoint]!};}
        else {c.phase='hold';next.mode='LOITER';c.target={...next.position};}
      }
    }
    const point={...next.position,timestamp:Date.now()};
    if(distance(d.position,next.position)>.002) {
      if(d.flightControl.phase==='return'||c.phase==='return') next.returnTrajectory=[...d.returnTrajectory,next.position].slice(-3000);
      else next.trajectory=[...d.trajectory,point].slice(-3000);
    }
    return next;
  })};
}
