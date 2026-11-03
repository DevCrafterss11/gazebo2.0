import { navigationPosition } from '../../domain/collaborationGps';
import type { Drone, Mission, TaskExecution, TaskGroup } from '../../types/collaboration';
import { distance3 } from '../../domain/collaborationPlanning';
import { moveDrone } from './collaborationKinematics';

const stationary = (d: Drone, dt: number): Drone => ({...d,velocity:{x:0,y:0,z:0},mode:d.armed?'LOITER':'待命',updatedAt:Date.now(),battery:Math.max(0,d.battery-(d.armed?dt*100/(d.endurance*60):0))});
const release = (d: Drone): Drone => ({...d,armed:false,assignedTaskId:null,taskGroupId:'',currentRole:'',role:'',instanceStatus:'STANDBY',status:'READY',mode:'待命',velocity:{x:0,y:0,z:0}});
const returnHome = (d: Drone): Drone => d.armed || d.position.z > d.homePosition.z+.05 ? {...d,instanceStatus:'RETURNING',mode:'RTL',armed:true} : release(d);
function advanceReturn(d: Drone,dt:number): Drone {
  const home=d.homePosition, atHome=Math.hypot(home.x-d.position.x,home.y-d.position.y)<.25;
  const sample=moveDrone(d,{...home,z:atHome?home.z:d.position.z},dt,true);
  const landed=distance3(sample.position,home)<.08;
  const next={...d,...sample,returnTrajectory:[...d.returnTrajectory,sample.position]};
  return landed?release({...next,position:{...home},attitude:[0,0,sample.attitude[2]]}):next;
}
function conclude(g: TaskGroup, drones: Drone[], success:boolean, reason=''): TaskGroup {
  for(let i=0;i<drones.length;i++) if(drones[i]!.assignedTaskId===g.runId) drones[i]=returnHome(drones[i]!);
  return {...g,status:success?'COMPLETE':'FAILED',lifecycle:'安全收尾',outcome:success?'success':'failure',failureReason:reason};
}
export function advancePlannedMission(mission: Mission,paused:boolean,dt:number): Mission {
  const drones=mission.drones.map(d=>!d.flightControl&&d.instanceStatus==='RETURNING'?advanceReturn(d,dt):{...d});
  const groups=mission.groups.map((original,index): TaskGroup=> {
    if(!original.plan||!original.execution||!original.runId||['已完成','已失败','已终止','配置中','待确认'].includes(original.lifecycle)) return original;
    let g={...original}, ex:TaskExecution={...original.execution,aircraft:original.execution.aircraft.map(a=>({...a})),confirmedBy:[...original.execution.confirmedBy]};
    g.execution=ex;
    if(g.lifecycle==='安全收尾') {
      ex.aircraft=ex.aircraft.map(a=>({...a,phase:drones.find(d=>d.id===a.droneId)?.instanceStatus==='RETURNING'?'returning':'done'})); return g;
    }
    const depleted=drones.find(d=>d.assignedTaskId===g.runId&&d.armed&&d.battery<=20);
    if(depleted) return conclude(g,drones,false,`${depleted.id} 模拟电量触及 20% 返航保留阈值，任务失败并安全收尾`);
    if(paused||g.lifecycle==='暂停'||g.lifecycle==='异常'||g.lifecycle==='待结果确认') {
      for(let i=0;i<drones.length;i++) if(drones[i]!.assignedTaskId===g.runId&&drones[i]!.instanceStatus==='FLYING') {
        const d=drones[i]!, target=original.plan.routes.find(r=>r.droneId===d.id)?.waypoints.at(-1);
        if(!paused&&g.lifecycle==='待结果确认'&&target) {
          const sample=moveDrone(d,target,dt);
          drones[i]={...d,...sample,mode:'LOITER',trajectory:[...d.trajectory,{...sample.position,timestamp:Date.now()}]};
        } else drones[i]=stationary(d,dt);
      }
      return g;
    }
    ex.seconds+=dt; g.elapsedTicks=ex.seconds/.85;
    const routes=original.plan.routes;
    for(let i=0;i<ex.aircraft.length;i++) {
      const a=ex.aircraft[i]!,route=routes[i]!,di=drones.findIndex(d=>d.id===a.droneId);
      if(di<0) return conclude(g,drones,false,`${a.droneId} 资源丢失`);
      let d=drones[di]!;
      if(d.instanceStatus==='RETURNING'||d.assignedTaskId!==g.runId) {a.phase=d.instanceStatus==='RETURNING'?'returning':'done';continue;}
      if(a.phase==='queued') {
        let ready=index===2 || !route.dependsOn || ex.reconConfirmed;
        if(index===2&&i>0) {
          const prev=ex.aircraft[i-1]!,prior=routes[i-1]!;
          const travel=distance3(d.homePosition,route.waypoints.at(-1)!)/Math.max(1,d.speed)+g.config.altitude/3+8;
          ready=ready&&(g.config.handover==='重叠监测' ? prev.phase==='working'&&prior.stationSeconds-prev.dwell<=travel||prev.completed : prev.completed);
        }
        if(!ready) continue;
        if(d.connectionStatus!=='CONNECTED'||d.battery<25||!d.available) return conclude(g,drones,false,`${d.id} 接替前检查失败：连接、电量或资源可用状态不满足要求`);
        a.phase='takeoff';a.launchedAt=ex.seconds;
        d={...d,armed:true,instanceStatus:'FLYING',status:'RUNNING',mode:'TAKEOFF'};
      }
      if(a.phase==='takeoff'||a.phase==='transit') {
        const target=route.waypoints[a.waypoint];
        if(!target) return conclude(g,drones,false,`${d.id} 缺少有效航点`);
        const sample=moveDrone(d,target,dt);
        d={...d,...sample,mode:a.phase==='takeoff'?'TAKEOFF':'AUTO',trajectory:[...d.trajectory,{...sample.position,timestamp:Date.now()}]};
        if(distance3(navigationPosition(d),target)<=.25) {
          a.waypoint++;
          if(a.waypoint>=route.waypoints.length) {a.phase='working';a.arrivedAt=ex.seconds;if(index===2&&i>0) ex.handovers++;}
          else a.phase='transit';
        }
      } else if(a.phase==='working') {
        d={...d,...moveDrone(d,route.waypoints.at(-1)!,dt),mode:'LOITER'};
        d.trajectory=[...d.trajectory,{...d.position,timestamp:Date.now()}];
        if(!a.completed) {
          a.dwell+=dt;
          // 定点监测：更新剩余监测时间
          if(index===2 && a.remainingStationSeconds !== undefined) {
            a.remainingStationSeconds = Math.max(0, route.stationSeconds - a.dwell);
          }
        }
        if(a.dwell+1e-6>=route.stationSeconds) {
          const next=ex.aircraft[i+1];
          const canLeave=index!==2||g.config.handover!=='重叠监测'||!next||next.arrivedAt!==undefined;
          if(canLeave&&!a.completed) {
            a.completed=true;
            if(index===2) {
              a.remainingStationSeconds = 0;
              if(next) {a.phase='returning';d=returnHome(d);}
            }
          }
        }
      }
      if(index===1&&route.role!=='中继机'&&original.plan.searchTarget&&g.config.scenario!=='negative-result'&&Math.hypot(d.position.x-original.plan.searchTarget.x,d.position.y-original.plan.searchTarget.y)<=Math.max(12,g.config.routeSpacing*2)&&d.position.z>=g.config.altitude-.5) {
        if(!ex.confirmedBy.includes(d.id)) ex.confirmedBy.push(d.id);
        ex.targetFound=ex.confirmedBy.length>=(g.config.confirmation==='双机确认'?2:1);
      }
      drones[di]=d;
    }
    if(index===2&&ex.aircraft.some(a=>a.arrivedAt!==undefined)&&!ex.aircraft.some(a=>a.phase==='working'&&!a.completed)&&ex.aircraft.some(a=>!a.completed)) ex.gapSeconds+=dt;
    // Progress comes from reached route segments and actual on-station time, never a wall-clock animation.
    const fractions=ex.aircraft.map((a,i)=>{
      const r=routes[i]!;
      return a.completed?1:r.stationSeconds>0?Math.min(.35,a.waypoint/r.waypoints.length*.35)+Math.min(.65,a.dwell/r.stationSeconds*.65):Math.min(1,a.waypoint/r.waypoints.length);
    });
    g.progress=Math.min(100,fractions.reduce((sum,f)=>sum+f,0)/Math.max(1,fractions.length)*100);
    g.dwellTicks=ex.aircraft.reduce((sum,a)=>sum+a.dwell,0)/.85;
    if(g.config.scenario==='execution-failure'&&ex.seconds>=12) return conclude(g,drones,false,'预设模拟执行故障：飞行链路异常，任务失败并请求模拟返航');
    const timeout=routes.reduce((sum,r)=>sum+r.estimatedSeconds,0)*3+120;
    if(ex.seconds>timeout) return conclude(g,drones,false,'执行超时：未能在模拟任务预算内完成航线或接力');
    if(index===4&&routes.some(r=>r.dependsOn)&&!ex.reconConfirmed&&ex.aircraft.find(a=>a.droneId===routes.find(r=>r.dependsOn)!.dependsOn)?.completed) {
      ex.awaiting='recon';g.lifecycle='待结果确认';return g;
    }
    if(ex.aircraft.every(a=>a.completed)) {
      g.progress=100;
      if(index===1&&!ex.targetFound) return conclude(g,drones,false,'搜索结束：未获得满足确认条件的演练目标，不计为搜索成功');
      if(index===0&&g.config.scenario==='negative-result') return conclude(g,drones,false,'模拟覆盖质量未达标：巡逻任务验收失败');
      if(index===2&&g.config.scenario==='negative-result') return conclude(g,drones,false,'模拟监测有效性检查失败：驻留数据不满足验收条件');
      const manual=index===4||index===1&&g.config.confirmation==='人工复核'||index===3&&(g.config.confirmation==='人工签收'||g.config.scenario==='negative-result');
      if(manual) {ex.awaiting='result';g.lifecycle='待结果确认';return g;}
      return conclude(g,drones,true);
    }
    return g;
  });
  return {...mission,groups,drones,tasks:mission.tasks.map(t=>{const g=groups.find(g=>g.taskId===t.id)!;return {...t,status:g.status,progress:g.progress,droneCount:g.drones.length};})};
}
