import { describeTaskRole, seatGaps } from '../../../domain/collaborationMission';
import { useCollaborationStore } from '../../../stores/collaborationStore';
import type { Drone, TaskRecord } from '../../../types/collaboration';
import type { FleetMapTool } from './FleetMap';
import { CoordinateEntry, MissionWorkflow } from './MissionWorkflow';
import { LiveTelemetry, SelectedDroneTelemetry } from './LiveTelemetry';
import { TaskResult } from './TaskResult';
import common from '../Collaboration.module.css';
import styles from '../TaskCommand.module.css';

export type TaskLayer = 'config' | 'members' | 'geometry' | 'history' | 'result' | 'events' | 'telemetry';
export const layerNames: Record<TaskLayer, string> = { config: '任务参数', members: '无人机编组', geometry: '区域与航点', history: '任务记录', result: '执行结果', events: '执行事件', telemetry: '实时遥测' };

export function TaskLayerContents({ layer, locked, snapshot, result, onHistory, onCurrent, onResources, onLayerChange, onDraw }: {
  layer: TaskLayer; locked: boolean; snapshot?: TaskRecord; result?: TaskRecord;
  onHistory: (id: string) => void; onCurrent: () => void; onResources: () => void; onLayerChange: (layer: TaskLayer) => void; onDraw: (tool: FleetMapTool) => void;
}) {
  const s = useCollaborationStore();
  const index = s.missionState.groups.findIndex((g) => g.id === s.selectedTaskGroup);
  const group = snapshot?.group ?? s.missionState.groups[index]!;
  const type = s.missionState.tasks[index]!.type;
  if (layer === 'telemetry') return <><SelectedDroneTelemetry snapshot={snapshot} />{!snapshot && <LiveTelemetry />}</>;
  if (layer === 'result') return result ? <TaskResult record={result} /> : <p>尚无执行结果。任务安全收尾完成后，评价会在此生成，轨迹继续保留在地图上。</p>;
  if (layer === 'history') {
    const records = s.records.filter((r) => r.groupId === group.id).slice().reverse();
    return <><p>历史记录保留配置、成员、轨迹与实际评价，不占用当前无人机。</p>{snapshot && <button type="button" onClick={onCurrent}>返回当前任务</button>}{records.length ? records.map((r) => <button className={styles.record} data-testid={`history-${r.id}`} type="button" key={r.id} onClick={() => onHistory(r.id)}><b>{r.name}</b><span>{r.evaluation.status} · {r.evaluation.completion}%</span><small>{new Date(r.startedAt).toLocaleString('zh-CN')}</small></button>) : <p>当前任务类型尚无执行记录。</p>}</>;
  }
  if (layer === 'events') {
    const events = (snapshot ?? result)?.events ?? s.events.filter((e) => s.businessView === 'global' || e.groupId === group.id && (!group.startedAt || e.time >= group.startedAt));
    return <ol className={common.eventTimeline}>{events.slice().reverse().map((e) => <li key={e.id}><time>{new Date(e.time).toLocaleTimeString('zh-CN')}</time><b>{e.title} · 模拟</b><span>{e.detail}</span></li>)}{!events.length && <li>尚无任务执行事件。</li>}</ol>;
  }
  if (layer === 'config') return <MissionWorkflow key={group.id} group={group} index={index} locked={locked} onDraw={onDraw} onMembers={() => onLayerChange('members')} />;
  if (layer === 'geometry') return <><CoordinateEntry key={group.id} index={index} locked={locked}/><div className={styles.workflow}><button type="button" disabled={locked} onClick={() => onDraw('point')}>{index === 0 || index === 1 ? '开始绘制区域' : index === 2 ? '设置监测点' : '添加航点'}</button>{index < 2 && <button type="button" disabled={locked} onClick={() => onDraw('rectangle')}>两点绘制矩形</button>}{index === 1 && <button type="button" disabled={locked} onClick={() => onDraw('target')}>地图设置演练目标点</button>}{(index === 3 || index === 4) && <><button type="button" disabled={locked} onClick={() => onDraw('start')}>{index === 3 ? '设置装载点' : '设置响应集结点'}</button><button type="button" disabled={locked} onClick={() => onDraw('delivery')}>{index === 3 ? '设置交付点' : '设置救援目标'}</button></>}</div>{index < 2 && <button type="button" disabled={locked || group.points.filter(p => p.kind === 'point').length < 3} onClick={s.closeTaskArea}>{group.areaClosed ? '区域已闭合' : '闭合区域'}</button>}<p>{index === 2 ? '本轮采用单点监测；重新点击会替换监测点。' : ''}点击地图添加点位；拖动顶点调整区域或航线，方向键微调 1m（Shift 为 5m）；拖动空白地图平移。坐标单位为米，与飞行轨迹使用同一坐标系。</p><div className={styles.coordinates}>{group.points.map((p, i) => <article key={i}><b>{p.kind === 'start' ? index === 3 ? '装载点' : '响应集结点' : p.kind === 'delivery' ? '交付 / 救援目标' : `点位 ${i + 1}`}</b>{(['x', 'y'] as const).map((axis) => <label key={axis}>{axis.toUpperCase()}<input aria-label={`点${i + 1}-${axis}`} type="number" disabled={locked} value={p[axis]} onChange={(e) => { if (Number.isFinite(e.target.valueAsNumber)) s.updateMapPoint(i, { ...p, [axis]: e.target.valueAsNumber }); }} /></label>)}<button type="button" disabled={locked} onClick={() => s.removeMapPoint(i)}>删除点</button></article>)}</div>{!group.points.length && <div className={styles.hint}>尚未绘制。{index === 0 || index === 1 ? '在地图连续点击至少三个顶点，形成任务区域。' : index === 3 ? '分别设置起点和交付点，可补充中间航点。' : '使用底部工具添加监测点或救援目标。'}</div>}{index < 2 ? <button type="button" disabled={locked || !group.points.some(p => p.kind === 'point')} title="仅清除区域顶点；保留无人机编组和演练目标点" onClick={() => { if (window.confirm('清除当前绘制区域？已有航线规划将失效；无人机编组及演练目标点会保留。')) s.clearTaskArea(); }}>清除区域</button> : <button type="button" disabled={locked || !group.points.length} onClick={s.clearMapPoints}>删除全部区域 / 航点</button>}</>;
  const members = group.drones.map(id => s.missionState.drones.find(d => d.id === id)).filter((d): d is Drone => !!d);
  const gaps = group.drones.length ? seatGaps(type, group) : ['还没有选择参与飞机'];
  return <>
    <p>已选 {group.drones.length} / {s.missionState.drones.length} 架。类型和载荷决定飞机能担任哪个岗位，系统按岗位自动安排分工和航线；此处不会解锁或起飞。</p>
    <p className={gaps.length ? styles.hint : undefined} role="status">{gaps.length ? `缺口：${gaps.join('；')}` : '编组完整，可以生成航线。'}</p>
    <div className={common.assignmentList}>{members.map(d => <div key={d.id} className={common.assignmentSelected}>
      <label><b>{d.id}</b><small>{d.droneType} · {d.payload} · {d.battery.toFixed(0)}%</small></label>
      <small>{describeTaskRole(group.roles[d.id] ?? '')}{d.assignedTaskId ? ' · 实际占用中' : ''}</small>
      <div><label><input type="checkbox" checked={d.visibleOnMap} aria-label={`${d.id}工作区地图显示`} onChange={() => s.toggleMapVisibility(d.id)} />地图</label><button type="button" onClick={() => s.selectDrone(d.id)}>定位</button>
        <button type="button" disabled={locked} aria-label={`将 ${d.id} 移出${type}`} onClick={() => s.setTaskDrone(group.id, d.id, false)}>移出</button></div>
    </div>)}</div>
    {!members.length && <p>还没有参与飞机。</p>}
    <button type="button" onClick={onResources}>打开无人机资源管理，选择飞机和岗位</button>
  </>;
}
