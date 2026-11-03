import { useState } from 'react';
import { useCollaborationStore } from '../../../stores/collaborationStore';
import { flightCommandIssue, flightCommandLabel } from '../../../domain/collaborationFlight';
import type { Drone, FlightCommand, FlightMode, Position } from '../../../types/collaboration';
import styles from '../LiveCommand.module.css';

/** Local form state only. Commands and all telemetry go through the shared store/adapter. */
export function FlightControls({ drone, onReturn, canReturn }: { drone: Drone; onReturn: () => void; canReturn: boolean }) {
  const s = useCollaborationStore();
  const [altitude,setAltitude]=useState(15);
  const [mode,setMode]=useState<FlightMode>('GUIDED');
  const [step,setStep]=useState(5);
  const [target,setTarget]=useState<Position>({...drone.position,z:drone.homePosition.z+15});
  const sample = () => [[drone.homePosition.x,drone.homePosition.y+15,drone.homePosition.z+15],[drone.homePosition.x+15,drone.homePosition.y+15,drone.homePosition.z+15],[drone.homePosition.x+15,drone.homePosition.y,drone.homePosition.z+15]].map(p=>p.join(', ')).join('\n');
  const [route,setRoute]=useState(sample);
  const [routeError,setRouteError]=useState('');
  const pending=s.flightCommands.some(r=>r.droneId===drone.id&&r.status==='pending');
  const receipts=s.flightCommands.filter(r=>r.droneId===drone.id).slice(-5).reverse();
  const issue=(c:FlightCommand)=>!s.clusterRunning||s.stopRequested?'模拟集群未运行或正在停止':pending?'等待上一条指令回执':flightCommandIssue(drone,c);
  const send=(c:FlightCommand)=>s.sendFlightCommand(drone.id,c);
  const button=(label:string,c:FlightCommand)=> <button key={label} type="button" disabled={!!issue(c)} title={issue(c)||`模拟${label} · ${drone.id}`} onClick={()=>send(c)}>{label}</button>;
  function upload() {
    const points=route.trim().split('\n').filter(Boolean).map(line=>line.split(/[,，\s]+/).map(Number));
    if(points.some(p=>p.length!==3||p.some(n=>!Number.isFinite(n)))) {setRouteError('每行输入 E, N, U 三个有限数值，以逗号或空格分隔。');return;}
    const waypoints=points.map(p=>({x:p[0]!,y:p[1]!,z:p[2]!}));
    const error=issue({type:'upload',waypoints});setRouteError(error);if(!error)send({type:'upload',waypoints});
  }
  return <>
    <section aria-label="单机模拟飞控"><h3>单机飞行 <small>模拟指令 · 回执后生效</small></h3>
      {drone.assignedTaskId && <p className={styles.capability}>任务占用中；单机手动指令已隔离。可使用下方任务控制或返航。</p>}
      <div className={styles.flightForm}><label>飞行模式<select aria-label="单机飞行模式" value={mode} onChange={e=>setMode(e.target.value as FlightMode)}>{(['GUIDED','LOITER','STABILIZE','AUTO','RTL','LAND'] as const).map(m=><option key={m}>{m}</option>)}</select></label>{button('切换模式',{type:'mode',mode})}</div>
      <div className={styles.controlRow}>{button('解锁',{type:'arm'})}{button('锁定',{type:'disarm'})}{button('悬停',{type:'hold'})}{button('降落',{type:'land'})}<button type="button" disabled={!canReturn||pending} onClick={onReturn}>返航</button></div>
      <div className={styles.flightForm}><label>起飞高度 / m<input aria-label="单机起飞高度" type="number" min="2" max="120" value={altitude} onChange={e=>setAltitude(e.target.valueAsNumber)}/></label>{button('起飞',{type:'takeoff',altitude})}</div>
      <p className={styles.capability}>初次解锁会准备 GUIDED 模式；收到回执后可直接起飞。高度相对本机 Home；空中禁止锁定。AUTO 完成后悬停。</p>
    </section>
    <section aria-label="单机移动控制"><h3>相对移动 <small>按机头方向 · 每次一个位移目标</small></h3>
      <div className={styles.flightForm}><label>移动步长 / m<input aria-label="单机移动步长" type="number" min="1" max="50" value={step} onChange={e=>setStep(e.target.valueAsNumber)}/></label><span>默认 5 m</span></div>
      <div className={styles.controlRow}>{([['前进','forward'],['后退','back'],['左移','left'],['右移','right'],['上升','up'],['下降','down']] as const).map(([label,direction])=>button(label,{type:'move',direction,distance:step}))}{button('左转 30°',{type:'yaw',degrees:-30})}{button('右转 30°',{type:'yaw',degrees:30})}</div>
      <details className={styles.secondaryControls}><summary>飞往指定坐标</summary><div className={styles.coordinateInputs}>{(['x','y','z'] as const).map((axis,i)=><label key={axis}>{['E / m','N / m','U / m'][i]}<input type="number" aria-label={`飞往坐标${axis}`} value={target[axis]} onChange={e=>setTarget({...target,[axis]:e.target.valueAsNumber})}/></label>)}</div>{button('飞往坐标',{type:'goto',target})}<p className={styles.capability}>ENU 米制坐标；U 是地图参考原点高度。</p></details>
    </section>
    <section aria-label="单机航线下发"><details className={styles.secondaryControls}><summary>航线下发与 AUTO 执行 <small>{drone.flightControl?.route.length??0} 个已接收航点</small></summary>
      <p className={styles.capability}>在地面锁定状态下发航线，再解锁起飞，切换 AUTO。可用地图坐标拾取填写 E, N, U。</p>
      <label className={styles.coordinateLabel}>每行一个航点（E, N, U / m）<textarea aria-label="单机航线坐标" value={route} onChange={e=>{setRoute(e.target.value);setRouteError('');}}/></label>
      <div className={styles.controlRow}><button type="button" onClick={()=>{setRoute(sample());setRouteError('');}}>填入示例航线</button><button type="button" disabled={pending||drone.armed||!!drone.assignedTaskId||!s.clusterRunning||s.stopRequested} onClick={upload}>下发航线</button>{button('执行 AUTO 航线',{type:'mode',mode:'AUTO'})}</div>
      {routeError&&<p role="alert" className={styles.capability}>{routeError}</p>}
    </details></section>
    <section aria-label="飞控指令回执"><h3>指令回执 <small>{pending?'等待 ACK':'最近 5 条'}</small></h3>
      <ol className={styles.commandReceipts} aria-live="polite">{receipts.map(r=><li key={r.id} data-command-status={r.status}><b>{flightCommandLabel(r.command)} · {r.status==='pending'?'等待确认':r.status==='accepted'?'已接收':'被拒绝'}</b><span>{r.detail}</span><time>{new Date(r.acknowledgedAt??r.requestedAt).toLocaleTimeString('zh-CN',{hour12:false})}</time></li>)}</ol>
      {!receipts.length&&<p className={styles.capability}>暂无指令。选中其他无人机不会改变本机执行状态。</p>}
    </section>
  </>;
}
