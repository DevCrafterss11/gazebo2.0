import { useState } from 'react';
import type { RefObject } from 'react';
import { ArrowDown, ArrowUp, Check, MapPinned, Route, Trash2, X } from 'lucide-react';
import { useCollaborationStore } from '../../../stores/collaborationStore';
import { describeTaskRole } from '../../../domain/collaborationMission';
import { collaborationMapFrame } from '../../../domain/collaborationMap';
import type { MapPoint, TaskGroup } from '../../../types/collaboration';
import { TaskSettings } from '../TaskSettings';
import type { FleetMapTool } from './FleetMap';
import styles from '../TaskWorkflow.module.css';

export const missionSteps = [
  ['绘制巡逻区域', '选择参与飞机', '生成覆盖航线', '检查与部署', '巡逻与验收'],
  ['设置搜索范围', '设置演练目标', '生成搜索航线', '检查与部署', '搜索结果确认'],
  ['选择监测队列', '设置监测点', '预览接力安排', '部署首架', '接力与验收'],
  ['设置运输点位', '选择运输飞机', '规划运输航线', '检查与部署', '确认模拟交付'],
  ['标注事件位置', '分配救援角色', '规划响应航线', '检查与部署', '现场确认与收尾'],
];
const phaseNames = { queued: '地面排队', takeoff: '模拟起飞', transit: '转场中', working: '到点执行', returning: '返航中', done: '已释放', failed: '失败' };
export function MissionWorkflow({group,index,locked,onDraw,onMembers}:{group:TaskGroup;index:number;locked:boolean;onDraw:(t:FleetMapTool)=>void;onMembers:()=>void}) {
  const s=useCollaborationStore();
  const [advanced,setAdvanced]=useState(false);
  return <div className={styles.workflow} data-mission-workflow={index}>
    <div className={styles.intro}><span>任务工作流 / {String(index+1).padStart(2,'0')}</span><h3>{['区域覆盖规划','协同搜索规划','定点接力监测','坐标运输规划','分阶段救援响应'][index]}</h3><p>{['闭合真实绘制区域，再生成逐机覆盖航线。','按搜索范围飞行，对明确的演练目标进行模拟确认。','驻留从到点计时，替换机从自己的 Home 起飞。','起飞点、装载点和交付点分别管理。','先侦察后救援时，现场确认是后续起飞的前置条件。'][index]}</p></div>
    {!locked&&<ol className={styles.steps}>{missionSteps[index]!.map((step,i)=><li key={step} data-complete={i<3&&!!group.plan}><span>{i<3&&group.plan?<Check size={12}/>:i+1}</span>{step}</li>)}</ol>}
    {!locked&&<div className={styles.shortcuts}><button type="button" onClick={()=>onDraw(index===3||index===4?'delivery':'point')}><MapPinned size={14}/>{index===0?'绘制巡逻区域':index===1?'绘制搜索区域':index===2?'设置监测点':index===3?'设置交付点':'设置事件位置'}</button>{index<2&&<button type="button" onClick={()=>onDraw('rectangle')}>两点绘制矩形</button>}{index<2&&<button type="button" className={styles.clearAreaAction} disabled={!group.points.some(p=>p.kind==='point')} title="仅清除当前区域及其规划；保留无人机编组和演练目标点" onClick={()=>{if(window.confirm('清除当前绘制区域？已有航线规划将失效；无人机编组及演练目标点会保留。'))s.clearTaskArea();}}><Trash2 size={14}/>清除区域</button>}{index===1&&<button type="button" onClick={()=>onDraw('target')}>地图设置演练目标点</button>}{(index===3||index===4)&&<><button type="button" onClick={()=>onDraw('start')}>{index===3?'设置装载点':'设置响应集结点'}</button><button type="button" onClick={()=>onDraw('point')}>添加途经航点</button></>}<button type="button" onClick={onMembers}>选择无人机 ({group.drones.length})</button></div>}
    {index===1&&<section className={styles.flowNote}><b>演练目标点</b><p>{group.config.targetEast !== undefined && group.config.targetNorth !== undefined ? `已设置：E ${group.config.targetEast.toFixed(1)} / N ${group.config.targetNorth.toFixed(1)} m · 仅模拟位置判定` : '尚未手动指定；规划时将自动生成一个演练目标，非摄像头识别。'}</p>{!locked&&<button type="button" disabled={group.config.targetEast===undefined&&group.config.targetNorth===undefined} onClick={()=>s.updateGroupConfig(group.id,{targetEast:undefined,targetNorth:undefined})}>清除手动目标 / 使用自动目标</button>}</section>}
    {(index===3||index===4)&&<section className={styles.flowNote}><b>{index===3?'运输点位检查':'救援点位检查'}</b><p>{index===3?'每架从自身 Home 起飞，先到装载点，再到交付点；可添加途经航点。':'起点为响应集结点，目标为救援事件点；先侦察后救援须在执行中人工确认侦察结果。'}</p><div className={styles.pointStatus}><span>{index===3?'装载点':'响应集结点'}：{group.points.some(p=>p.kind==='start')?'已设置':'待设置'}</span><span>{index===3?'交付点':'救援事件点'}：{group.points.some(p=>p.kind==='delivery')?'已设置':'待设置'}</span><span>途经航点：{group.points.filter(p=>p.kind==='point').length}</span></div></section>}
    {!locked&&<label className={styles.field}>任务名称<input aria-label="任务名称" value={group.name} disabled={locked} onChange={e=>s.updateGroup(group.id,{name:e.target.value})}/></label>}
    {index===2&&<section className={styles.queue}><h4>接力队列 <small>按顺序执行</small></h4>{!group.drones.length&&<p>先选择参与飞机，再调整接力顺序。</p>}{group.drones.map((id,i)=>{
      const a=group.execution?.aircraft.find(a=>a.droneId===id);
      const remainingTime = a?.remainingStationSeconds !== undefined ? a.remainingStationSeconds : Math.max(0,(group.plan?.routes[i]?.stationSeconds??group.config.duration)-(a?.dwell??0));
      return <article key={id}><b>{i+1}</b><div><strong>{id}</strong><small>{a?`${phaseNames[a.phase]} · ${a.phase==='working'&&a.completed?'驻留已满 · 等待接替机到点':a.phase==='working'&&!a.completed?`驻留倒计时 ${remainingTime.toFixed(1)} s` : a.completed?`驻留完成 ${a.dwell.toFixed(1)} s` : a.phase==='queued'&&i>0?`待前机${group.config.handover==='重叠监测'?'接近交接窗口':'完成驻留并返航'}后自动起飞` : a.phase==='queued'?'等待模拟起飞':`已驻留 ${a.dwell.toFixed(1)} s`}`:`计划驻留 ${(group.plan?.routes[i]?.stationSeconds??group.config.duration).toFixed(1)} s / 从自身 Home 起飞`}</small></div><button type="button" aria-label={`${id}上移`} disabled={locked||i===0} onClick={()=>s.reorderTaskDrone(id,-1)}><ArrowUp size={13}/></button><button type="button" aria-label={`${id}下移`} disabled={locked||i===group.drones.length-1} onClick={()=>s.reorderTaskDrone(id,1)}><ArrowDown size={13}/></button></article>;
    })}</section>}
    {index===2&&group.execution&&<p className={styles.queueTotals}>模拟接力 {group.execution.handovers} 次 · 累计监测空窗 {group.execution.gapSeconds.toFixed(1)} s{group.execution.aircraft.some(a=>a.phase==='working'&&!a.completed)?' · 当前有飞机到点驻留':' · 当前无飞机驻留'}</p>}
    {group.plan&&<PlanSummary group={group}/>}
    <TaskSettings group={group} index={index} disabled={locked} onChange={patch=>s.updateGroupConfig(group.id,patch)}/>
    {!group.plan&&<PlanSummary group={group}/>}
    {!locked&&<details className={styles.examples} open={advanced} onToggle={e=>setAdvanced(e.currentTarget.open)}><summary>模拟演练与验收场景</summary><p>以下均为明确配置的模拟数据，不连接摄像头或真实飞控。</p><button type="button" onClick={s.loadTaskExample}>载入本任务模拟示例</button><label className={styles.field}>验收场景<select aria-label="模拟验收场景" value={group.config.scenario??'success'} onChange={e=>s.updateGroupConfig(group.id,{scenario:e.target.value as NonNullable<typeof group.config.scenario>})}><option value="success">正常模拟执行</option><option value="upload-failure">下发失败（首架拒绝）</option><option value="execution-failure">执行故障（12 秒后）</option><option value="negative-result">{['覆盖验收不通过','未发现演练目标','监测有效性不通过','交付被拒绝','现场确认不通过'][index]}</option></select></label></details>}
  </div>;
}
export function PlanSummary({group}:{group:TaskGroup}) {
  const s=useCollaborationStore(),p=group.plan;
  return <section className={styles.planSummary} aria-label="分机规划结果"><h4><Route size={15}/>分机航线预览 <small>{p?'已生成':'尚未生成'}</small></h4>{!p?<p>完成点位和编组后，点击底部“生成航线”。参数、点位或参与飞机变化都会使旧方案失效。</p>:<>
    {p.coverageHeading !== undefined && <p>{p.regions?.length ? `等面积分区 ${p.regions.length} 区 · 区内蛇形扫描` : '分段周界巡逻'} · 航向 {p.coverageHeading.toFixed(1)}° · {group.config.headingMode === 'auto' ? '自动长边方向' : '手动方向'}</p>}<div className={styles.planMetrics}><span>{p.area>0?`${p.area.toFixed(0)} m²`:`${p.routes.length} 架`}<small>{p.area>0?'任务区域':'独立航线'}</small></span><span>{p.routes.reduce((n,r)=>n+r.length,0).toFixed(0)} m<small>总航程 · 含返航</small></span></div>
    {p.routes.map((r,i)=><button key={r.droneId} type="button" className={styles.routeRow} onClick={()=>s.selectDrone(r.droneId)}><i style={{background:routeColors[(p.regions?.findIndex(region=>region.droneId===r.droneId) ?? i) % routeColors.length]}}/><span><b>{p.regions?.find(region=>region.droneId===r.droneId)?.name ?? (r.role==='中继机'?'定点中继':'任务航线')} · {r.droneId} · {describeTaskRole(r.role)}</b><small>{p.regions?.find(region=>region.droneId===r.droneId) ? `${p.regions.find(region=>region.droneId===r.droneId)!.area.toFixed(0)} m² / ` : ''}{r.waypoints.length-r.workStart} 个作业航点 / 高度 {r.waypoints[0]!.z} m / {r.length.toFixed(0)} m / 预计 {r.estimatedSeconds.toFixed(0)} s{r.dependsOn?` / 等待 ${r.dependsOn} 侦察确认`:''}</small></span></button>)}
    {group.taskId==='task-2'&&p.routes.some(r=>r.role==='中继机')&&<p>中继位置由生成航线时自动选定，按方案驻留到任务收尾，不占搜索分区、不参与目标确认；不模拟真实信号覆盖。</p>}
    {p.searchTarget&&<p>演练目标坐标：E {p.searchTarget.x.toFixed(1)} / N {p.searchTarget.y.toFixed(1)} m；非真实识别。</p>}
    <small className={styles.caution}>{p.warnings.join(' ')}</small>
  </>}</section>;
}
export const routeColors=['#4dc7ff','#f2ba62','#70dbc5','#ba9af3','#f4839b','#b8d778'];

export function CoordinateEntry({index,locked}:{index:number;locked:boolean}) {
  const s=useCollaborationStore(),g=s.missionState.groups.find(g=>g.id===s.selectedTaskGroup)!;
  const [system,setSystem]=useState('enu'),[east,setEast]=useState(''),[north,setNorth]=useState(''),[kind,setKind]=useState<MapPoint['kind']>(index>=3?'delivery':'point'),[error,setError]=useState('');
  const submit=()=>{
    const x=Number(east),y=Number(north);
    if(!east.trim()||!north.trim()||!Number.isFinite(x)||!Number.isFinite(y)||system==='geo'&&(x < -180||x > 180||y <= -85||y >= 85)) {setError('请输入有效坐标；经纬度使用 WGS84，经度在前。');return;}
    const p=system==='geo'?collaborationMapFrame(s.missionState.mapReference).toLocal([x,y]):{x,y};
    if(Math.abs(p.x)>20000||Math.abs(p.y)>20000) {setError('点位超出原点 20 km 模拟范围。');return;}
    s.addMapPoint({...p,z:g.config.altitude,kind});setError('');
  };
  return <section className={styles.coordinateEntry}><h4>手动设置坐标</h4><div className={styles.coordinateOptions}><select aria-label="坐标输入系统" disabled={locked} value={system} onChange={e=>{setSystem(e.target.value);setEast('');setNorth('');}}><option value="enu">ENU 米制坐标</option><option value="geo">WGS84 经纬度</option></select><select aria-label="坐标点类型" disabled={locked} value={kind} onChange={e=>setKind(e.target.value as MapPoint['kind'])}><option value="point">{index<2?'区域顶点':index===2?'监测点':'途经航点'}</option>{index>=3&&<><option value="start">装载 / 出发点</option><option value="delivery">{index===3?'交付点':'事件目标'}</option></>}</select></div><div className={styles.coordinateOptions}><label>{system==='geo'?'经度':'东向 E（m）'}<input aria-label="手动坐标东向或经度" disabled={locked} type="number" value={east} onChange={e=>setEast(e.target.value)}/></label><label>{system==='geo'?'纬度':'北向 N（m）'}<input aria-label="手动坐标北向或纬度" disabled={locked} type="number" value={north} onChange={e=>setNorth(e.target.value)}/></label></div>{error&&<p role="alert">{error}</p>}<button type="button" disabled={locked} onClick={submit}>添加坐标点</button></section>;
}

export function DeploymentDialog({group,index,dialogRef,onClose,onDeferred,onStarted}:{group:TaskGroup;index:number;dialogRef:RefObject<HTMLDialogElement|null>;onClose:()=>void;onDeferred:()=>void;onStarted:()=>void}) {
  const s=useCollaborationStore(),p=group.plan;
  const [consent,setConsent]=useState(false);
  const concurrentMode = s.concurrentMode;
  const scheduled=index===2&&group.drones.length>1||!!p?.routes.some(r=>r.dependsOn);
  const stage=p?.stage==='armed'?3:p?.stage==='uploaded'?2:1;

  const handleStart = () => {
    if (concurrentMode) {
      // 并发模式：提交到调度器
      const success = s.submitTaskToScheduler(group.id);
      if (success) onStarted();
    } else {
      // 单任务模式：直接执行
      if (s.startExecution()) onStarted();
    }
  };

  return <dialog ref={dialogRef} className={styles.deploymentBackdrop} aria-label="当前任务确认" onCancel={e=>{e.preventDefault();e.stopPropagation();onClose();}}><section className={styles.deployment} aria-label="模拟任务部署"><header><div><small>SIMULATED MISSION DEPLOYMENT{concurrentMode && ' · 并发模式'}</small><h2>{group.name} · 执行前部署</h2></div><button autoFocus type="button" aria-label="关闭任务确认" onClick={onClose}><X size={19}/></button></header>
    <ol className={styles.deploySteps}>{['方案检查','下发回执','模拟解锁',concurrentMode?'提交调度':'确认起飞'].map((name,i)=><li key={name} data-active={i===stage} data-complete={i<stage}><span>{i<stage?<Check size={13}/>:i+1}</span>{name}</li>)}</ol>
    <p className={styles.safety}>纯前端教学模拟：无真实飞控、摄像头、载荷机构控制。{concurrentMode?'并发模式：独立编组可同时运行；高度层不做强制避碰校验，航线可能交叠，不代表真实飞行安全。':'仅启动当前任务，其他任务保持待命。'}</p>
    <div className={styles.deployMeta}><span>方案 <b>{p?.id}</b></span><span>参与 <b>{group.drones.length} 架</b></span><span>高度 <b>{group.config.altitude} m</b></span></div>
    <div className={styles.tableWrap}><table><thead><tr><th>无人机 / 分工</th><th>航线 / 预计航程</th><th>资源状态</th><th>模拟回执</th></tr></thead><tbody>{p?.routes.map(r=>{const d=s.missionState.drones.find(d=>d.id===r.droneId)!;const receipt=p.receipts.find(a=>a.droneId===r.droneId);return <tr key={r.droneId}><td><b>{r.droneId}</b><small>{describeTaskRole(r.role)}</small></td><td>{r.waypoints.length} 个航点<small>高度 {r.waypoints[0]!.z} m / {r.length.toFixed(0)} m · 预计 {r.estimatedSeconds.toFixed(0)} s</small></td><td>{d.battery.toFixed(0)}% 电量<small>{d.armed?'模拟已解锁 / 仍在地面':d.connectionStatus==='CONNECTED'?'已连接 / 地面待命':'连接异常'}</small></td><td data-rejected={receipt&&!receipt.accepted}>{receipt?.detail??'尚未下发'}</td></tr>;})}</tbody></table></div>
    {scheduled&&<label className={styles.consent}><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>授权本任务后续队列按既定条件自动模拟解锁与起飞；未轮到的飞机保持地面待命。</label>}
    {p?.warnings.map(w=><p key={w} className={styles.caution}>{w}</p>)}
    {s.notice&&<p className={styles.deployNotice} role="status">{s.notice}</p>}
    <footer><button type="button" onClick={onClose}>取消部署 / 返回配置</button>{concurrentMode && p?.stage === 'armed' && <button type="button" onClick={onDeferred}>保留部署，稍后启动</button>}{p?.stage==='planned'?<button className={styles.primary} type="button" onClick={()=>s.distributeTask()}>下发模拟航线</button>:p?.stage==='uploaded'?<button className={styles.primary} type="button" onClick={()=>s.armTask()}>模拟解锁</button>:<button className={styles.primary} type="button" disabled={scheduled&&!consent} onClick={handleStart}>{concurrentMode?'调度并立即模拟起飞':'确认模拟起飞'}</button>}</footer>
  </section></dialog>;
}
