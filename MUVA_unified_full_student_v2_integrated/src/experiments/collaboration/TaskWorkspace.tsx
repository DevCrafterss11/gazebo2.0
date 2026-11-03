import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Activity, ArrowLeft, ClipboardList, Layers, List, MapPinned, Pause, Play, Radio, Settings2, Shield, Square, Users, X } from 'lucide-react';
import { useCollaborationStore } from '../../stores/collaborationStore';
import { inspectTask, validateTask } from '../../domain/collaborationMission';
import { FleetMap, type FleetMapTool } from './components/FleetMap';
import { ResourceManager } from './components/ResourceManager';
import { LiveCommandView } from './LiveCommandView';
import { TaskLayerContents, layerNames, type TaskLayer } from './components/TaskLayerContents';
import common from './Collaboration.module.css';
import styles from './TaskCommand.module.css';
import { DeploymentDialog } from './components/MissionWorkflow';
import { TaskEntryPage } from './TaskEntryPage';
import { AttackControlPanel } from './components/AttackControlPanel';

import { TaskOverviewPanel, taskDisplayStatus } from './components/TaskOverviewPanel';

/** The teaching entry never mounts a map. Full-screen command is a separate surface. */
export function TaskWorkspace() {
  const [open, setOpen] = useState(false);
  const launcher = useRef<HTMLDivElement>(null);
  const hasOpened = useRef(false);
  useEffect(() => {
    if (open) hasOpened.current = true;
    else if (hasOpened.current) launcher.current?.querySelector('button')?.focus();
  }, [open]);
  const s = useCollaborationStore();
  const enter = (id?: string) => {
    if (id) s.setBusinessView(id);
    setOpen(true);
  };
  return <><div ref={launcher}><TaskEntryPage onOpen={enter} /></div>{open && <CommandStation onClose={() => setOpen(false)} />}</>;
}

/** One map and one resource pool, mounted only inside the full-screen dialog. */
function CommandStation({ onClose }: { onClose: () => void }) {
  const s = useCollaborationStore();
  const [liveView, setLiveView] = useState(false);
  const liveLauncher = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const launchDialog = useRef<HTMLDialogElement>(null);
  const layerBody = useRef<HTMLDivElement>(null);
  const [resources, setResources] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [layer, setLayer] = useState<TaskLayer | null>(null);
  const [attackPanel, setAttackPanel] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const collapse = () => { if (layer && stage.clientWidth > 0 && stage.clientWidth < 900) setRailOpen(false); };
    const observer = new ResizeObserver(collapse);
    observer.observe(stage); collapse();
    return () => observer.disconnect();
  }, [layer]);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [editTool, setEditTool] = useState<FleetMapTool>('pan');
  const [errorsVisible, setErrorsVisible] = useState(false);
  const global = s.businessView === 'global';
  const index = s.missionState.groups.findIndex((g) => g.id === s.selectedTaskGroup);
  const group = s.missionState.groups[index]!;
  const type = s.missionState.tasks[index]!.type;
  const snapshot = s.records.find((r) => r.id === historyId);
  const result = snapshot ?? s.records.find((r) => r.id === group.runId);
  const finished = group.lifecycle === '已完成' || group.lifecycle === '已终止' || group.lifecycle === '已失败';
  const locked = (s.isRunning && !s.concurrentMode || !!group.runId || group.lifecycle === '安全收尾') || finished || !!snapshot;
  const active = s.concurrentMode && !s.runningTaskGroupIds.includes(group.id) ? undefined : s.missionState.groups.find((g) => g.id === s.activeGroupId);
  const errors = validateTask(s.missionState, group);
  const safeTool = global || locked ? 'pan' : editTool;
  const mapSnapshot = !global ? snapshot ?? (finished ? result : undefined) : undefined;
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.showModal();
    return () => { document.body.style.overflow = previous; };
  }, []);
  useEffect(() => { if (confirm) launchDialog.current?.showModal(); }, [confirm]);
  // A new task, overlay, or generated plan must not inherit a previous panel's scroll offset.
  useEffect(() => { if (layerBody.current) layerBody.current.scrollTop = 0; }, [group.id, group.plan?.id, layer, historyId]);
  const defaultLayer = (id: string): TaskLayer | null => id === 'global' ? null : s.runningTaskGroupIds.includes(id) ? 'events' : s.missionState.groups.find((g) => g.id === id)?.runId ? 'result' : 'config';
  const select = (id: string, nextLayer: TaskLayer | null = defaultLayer(id)) => {
    s.setBusinessView(id); setHistoryId(null); setLayer(nextLayer); setEditTool('pan'); setErrorsVisible(false);
    if (window.matchMedia('(max-width: 760px)').matches) setRailOpen(false);
  };
  const createTask = (id: string, reuse = false) => {
    const target = s.missionState.groups.find((g) => g.id === id)!;
    if (!reuse && !target.runId && (target.points.length || target.drones.length) && !window.confirm('新建任务将替换此类型的当前草稿，是否继续？')) return;
    select(id, 'config'); s.newTask(reuse);
  };
  const inspectDrone = (id: string) => { s.selectDrone(id); setLayer('telemetry'); };
  const start = () => {
    setErrorsVisible(true);
    if (s.prepareTask()) { setEditTool('pan'); setConfirm(true); }
    else { const checks = inspectTask(s.missionState, group); setLayer(checks.parameters.length ? 'config' : checks.geometry.length ? 'geometry' : checks.members.length ? 'members' : 'config'); }
  };
  const closeConfirm = () => { setConfirm(false); s.cancelTaskPreparation(group.id); };
  const content = <section className={`${common.commandStation} ${styles.station} ${styles.immersive}`} aria-label="独立任务地图指挥台">
    <header className={styles.header}>
      <div className={styles.brand}><MapPinned size={22} /><div><b>网页地面站指挥平台</b><small>MOCK 教学模拟 · 15 架统一资源池</small></div></div>
      <nav className={styles.navigation} aria-label="任务业务导航"><button type="button" aria-pressed={global} onClick={() => select('global')}>全局态势</button>{s.missionState.groups.map((g, i) => <button type="button" key={g.id} aria-pressed={!global && group.id === g.id} onClick={() => select(g.id)}><i style={{ background: g.color }} />{s.missionState.tasks[i]!.type}</button>)}</nav>
      <div className={styles.headerActions}><label style={{display:'flex',alignItems:'center',gap:6,fontSize:12}}><input aria-label="并发调度模式" type="checkbox" checked={s.concurrentMode} disabled={s.isRunning} onChange={s.toggleConcurrentMode} />并发调度</label><button ref={liveLauncher} type="button" onClick={() => setLiveView(true)}><Radio size={17} />集群实时视图</button><button type="button" title="安全攻防演练" aria-label="安全攻防演练" onClick={() => { setAttackPanel(true); setLayer(null); }} style={{ color: attackPanel ? '#ff6b6b' : undefined }}><Shield size={19} />攻击面板</button><button type="button" title="无人机资源管理" aria-label="无人机资源管理" onClick={() => setResources(true)}><Settings2 size={19} /></button><button type="button" onClick={onClose}><ArrowLeft size={17} />返回教学页面</button></div>
    </header>
    <div ref={stageRef} className={styles.stage} data-command-stage>
      <div className={styles.mapHost}><FleetMap commandIcons taskPanelOpen={!!layer} onMapToolsOpen={() => setLayer(null)} global={global} locked={locked} snapshot={mapSnapshot} editTool={safeTool} onInspectDrone={inspectDrone} onPopupOpen={() => { if ((stageRef.current?.clientWidth ?? 0) < 900) { setLayer(null); setRailOpen(false); } }} frameKey={`${global}-${group.id}-${historyId}-${railOpen}-${!!layer}`} /></div>
      <div className={styles.situation} data-map-top><span><i />{s.clusterRunning ? '集群运行' : '集群已停止'}</span><span><Radio size={14} />{s.communicationNodes.filter((n) => n.network === '模拟在线').length}/15 模拟心跳</span><span>{s.missionState.drones.filter((d) => d.instanceStatus === 'FLYING').length} 飞行 · {s.missionState.drones.filter((d) => d.instanceStatus === 'RETURNING').length} 返航</span><b>二维地图 · Mock 位置 / ENU</b></div>
      <TaskOverviewPanel open={railOpen} onToggle={() => { if (!railOpen && (stageRef.current?.clientWidth ?? 0) < 900) setLayer(null); setRailOpen(!railOpen); }} onSelect={id => select(id)} onCreate={createTask} onHistory={(id, recordId) => { select(id, 'result'); setHistoryId(recordId); }} />
      <nav className={styles.layerDock} data-map-top aria-label="任务业务工具">{([
        { label: '任务规划', tools: [['config', Settings2], ['members', Users], ['geometry', MapPinned]] },
        { label: '执行监控', tools: [['telemetry', Radio], ['events', Activity]] },
        { label: '任务档案', tools: [['history', List], ['result', ClipboardList]] },
      ] as const).map(section => {
        const tools = section.tools.filter(([id]) => !global || id === 'telemetry' || id === 'events');
        return tools.length > 0 && <div key={section.label} className={styles.toolGroup}><small>{section.label}</small><div>{tools.map(([id, Icon]) => <button type="button" key={id} title={layerNames[id]} aria-label={layerNames[id]} aria-pressed={layer === id} onClick={() => { setLayer(layer === id ? null : id); setEditTool('pan'); }}><Icon size={15} /><span>{layerNames[id]}</span></button>)}</div></div>;
      })}</nav>
      {attackPanel && <AttackControlPanel onClose={() => setAttackPanel(false)} />}
      {!attackPanel && layer && <aside data-map-obstruction="right" className={styles.layer} role="region" aria-label={`${layerNames[layer]}图层`}><header><div><Layers size={17} /><b>{layerNames[layer]}</b></div><button type="button" aria-label="关闭地图图层" onClick={() => setLayer(null)}><X size={18} /></button></header><div className={styles.layerContext}>{global ? '统一资源池' : `${type} · ${snapshot ? '历史快照 / 只读' : taskDisplayStatus(group)}`}</div><div ref={layerBody} className={styles.layerBody}><TaskLayerContents layer={layer} locked={locked} snapshot={mapSnapshot} result={result} onHistory={(id) => { setHistoryId(id); setLayer('result'); setEditTool('pan'); }} onCurrent={() => { setHistoryId(null); setLayer(defaultLayer(group.id)); }} onResources={() => setResources(true)} onLayerChange={setLayer} onDraw={(tool) => { setEditTool(tool); setLayer(null); if (window.matchMedia('(max-width: 760px)').matches) setRailOpen(false); }} /></div><footer>{snapshot && <button type="button" onClick={() => { setHistoryId(null); setLayer(defaultLayer(group.id)); }}>返回当前任务</button>}<button type="button" onClick={() => setLayer(null)}>收起图层</button></footer></aside>}
      {safeTool !== 'pan' && <div className={styles.drawingHint} role="status">{safeTool === 'rectangle' ? '点击矩形两个对角点，自动闭合；替换当前区域。完成后可拖动顶点，再生成蛇形航线。' : safeTool === 'point' ? index === 0 || index === 1 ? '依次点击区域顶点，拖动可调整；完成后闭合区域，再生成分机航线。' : '点击地图添加监测点或航点。' : safeTool === 'start' ? index === 3 ? '点击地图设置装载点；无人机仍从各自 Home 起飞。' : '点击地图设置响应集结点。' : safeTool === 'target' ? '点击地图指定演练目标点；目标须位于搜索范围内，不代表真实识别。' : '点击地图设置交付点 / 救援事件点。'}{safeTool !== 'rectangle' && safeTool !== 'target' && <button type="button" disabled={!group.points.length} onClick={() => s.removeMapPoint(group.points.length - 1)}>撤销末点</button>}<button type="button" onClick={() => { if (safeTool === 'point' && index < 2 && group.points.filter(p => p.kind === 'point').length >= 3 && !s.closeTaskArea()) return; setEditTool('pan'); setLayer('config'); }}>完成绘制</button></div>}
      <div className={styles.bottomStack} data-command-bottom>
        <div className={styles.statusMessages}>
        {active?.lifecycle === '待结果确认' && <div className={styles.notice} role="status">{active.execution?.awaiting === 'recon' ? '侦察阶段已完成：请确认现场侦察结果；通过后救援机才会起飞，中继机保持驻留。' : '执行阶段已完成：请确认模拟处置结果，随后参与机自动返航。'}</div>}
        {active?.lifecycle === '异常' && <div className={styles.alert} role="alert">关键角色退出或资源不足，当前任务等待处置。<button type="button" onClick={() => s.failExecution('关键角色退出或资源不足，操作员确认任务失败')}>确认失败并返航</button></div>}
        {s.notice && <div className={styles.notice} role="status">{s.notice}</div>}
        {!global && !locked && errorsVisible && errors.length > 0 && <div className={styles.alert} role="alert">请补全配置：{errors.join('；')}<button type="button" onClick={() => setLayer('members')}>检查编组</button></div>}
        </div>
        <footer className={styles.toolbar} data-task-phase={active ? active.lifecycle === '安全收尾' ? 'returning' : active.lifecycle === '待结果确认' ? 'verification' : 'executing' : finished ? group.outcome === 'failure' ? 'failed' : 'completed' : group.plan ? 'planned' : 'configuration'}>
          <div className={styles.taskStatus}><b>{global ? '全局态势' : snapshot ? `${snapshot.name} · 历史` : group.name}</b><small>{global ? '从左侧选择任务，或打开资源设置配置任务资格' : `${snapshot ? snapshot.group.lifecycle : group.plan && !group.runId ? '航线已规划 / 待部署' : taskDisplayStatus(group)} · ${snapshot ? snapshot.group.drones.length : group.drones.length} 架 · ${Math.round(snapshot ? snapshot.group.progress : group.progress)}%`}</small>{!global && <progress max="100" value={snapshot ? snapshot.group.progress : group.progress} aria-label="当前任务进度" />}</div>
          <div className={styles.operations}>
            {snapshot ? <button type="button" onClick={() => { setHistoryId(null); setLayer(defaultLayer(group.id)); }}>返回当前任务</button> : active && (global || active.id !== group.id) ? <button type="button" className={styles.start} onClick={() => select(active.id, 'events')}>返回执行任务：{active.name}</button> : active ? <>
              {active.lifecycle === '待结果确认' && <button className={styles.start} type="button" onClick={() => s.confirmTaskResult(true)}>{active.execution?.awaiting === 'recon' ? '通过模拟侦察确认' : index === 3 ? '确认模拟交付' : index === 1 ? '通过搜索结果复核' : '确认模拟处置结果'}</button>}{active.lifecycle === '待结果确认' && <button className={styles.danger} type="button" onClick={() => s.confirmTaskResult(false)}>验收不通过</button>}
              <button type="button" disabled={!['执行中', '暂停'].includes(active.lifecycle)} onClick={active.lifecycle === '暂停' ? s.resumeExecution : s.pauseExecution}>{active.lifecycle === '暂停' ? <Play size={15} /> : <Pause size={15} />}{active.lifecycle === '暂停' ? '继续任务' : '暂停任务'}</button>
              <button className={styles.danger} type="button" disabled={active.lifecycle === '安全收尾'} onClick={() => { if (window.confirm('终止当前任务并请求参与无人机安全返航？')) s.terminateExecution(); }}><Square size={15} />终止任务</button>
              <button type="button" disabled={!s.missionState.drones.some((d) => d.instanceStatus === 'FLYING' && d.assignedTaskId === active.runId)} onClick={() => { const d = s.missionState.drones.find((d) => d.instanceStatus === 'FLYING' && d.assignedTaskId === active.runId); if (d) s.injectFailure('LOW_BATTERY', d.id); }}>模拟异常</button><button type="button" onClick={() => setLayer('telemetry')}>飞行遥测</button>
            </> : !global && !snapshot ? finished ? <><button type="button" onClick={() => setLayer('result')}>查看执行结果</button><button type="button" onClick={() => createTask(group.id, true)}>返回配置 / 再次执行</button><button type="button" onClick={() => createTask(group.id)}>新建{type}</button></> : <>
              <button type="button" onClick={() => { setLayer('geometry'); setEditTool('pan'); }}>{index === 0 ? '区域规划' : index === 1 ? '搜索范围' : index === 2 ? '监测点与队列' : index === 3 ? '运输点位' : '事件与航点'}</button>
              <button type="button" onClick={() => setLayer('members')}><Users size={15} />编组 ({group.drones.length})</button>
              {!group.plan ? <button className={styles.start} type="button" disabled={!s.clusterRunning} onClick={() => { setEditTool('pan'); setErrorsVisible(true); s.generateTaskPlan(); setLayer('config'); }}>生成{index === 2 ? '接力方案' : index === 4 ? '救援航线' : index === 3 ? '运输航线' : index === 1 ? '搜索航线' : '巡逻航线'}</button>
                : <><button type="button" onClick={() => setLayer('config')}>检查规划</button><button className={styles.start} type="button" disabled={!s.clusterRunning} onClick={start}><Play size={15} />检查并部署</button></>}

            </> : snapshot ? <button type="button" onClick={() => { setHistoryId(null); setLayer(defaultLayer(group.id)); }}>返回当前任务</button> : <><button type="button" onClick={() => setLayer('telemetry')}>机队实时遥测</button><button type="button" onClick={() => setResources(true)}>配置资源资格</button></>}
          </div>
        </footer>
      </div>
    </div>
    {resources && <ResourceManager onClose={() => setResources(false)} />}
    {confirm && <DeploymentDialog group={group} index={index} dialogRef={launchDialog} onClose={closeConfirm} onDeferred={() => { setConfirm(false); setLayer('config'); }} onStarted={() => { setConfirm(false); setLayer('events'); setErrorsVisible(false); }} />}

  </section>;
  return <>{createPortal(<dialog ref={dialog} className={styles.dialog} aria-label="独立任务全屏工作区" onCancel={(e) => { e.preventDefault(); if (confirm) closeConfirm(); else if (layer) setLayer(null); else onClose(); }}>{content}</dialog>, document.body)}{liveView && <LiveCommandView onClose={() => { setLiveView(false); requestAnimationFrame(() => liveLauncher.current?.focus()); }} />}</>;
}
