import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Battery, Check, Circle, Crosshair, Layers3, MapPin, Maximize2, Minus, Play, Plus, Radio, Ruler, Satellite, Settings2, ShieldCheck, Square, Terminal } from 'lucide-react';
import { useCollaborationStore } from '../../stores/collaborationStore';
import type { Drone } from '../../types/collaboration';
import shared from './Collaboration.module.css';
import styles from './ClusterStartup.module.css';

const stages = ['Gazebo World', '15 × SITL 实例', 'MAVLink 转发服务', '无人机节点就绪'];
const instanceLabels: Record<Drone['instanceStatus'], string> = {
  STOPPED: '未启动', STARTING: '启动中', STANDBY: '待命', FLYING: '飞行中', RETURNING: '返航中', FAULT: '异常',
};
const time = (value: number | null) => value ? new Date(value).toLocaleTimeString('zh-CN', { hour12: false }) : '尚无数据';

/** Step 2 presentation only. Lifecycle and telemetry remain owned by the existing store/runtime. */
export function ClusterStartup() {
  const s = useCollaborationStore();
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => { rootRef.current?.closest('main')?.scrollTo({ top: 0, left: 0 }); }, []);
  const [zoom, setZoom] = useState(1);
  const gridId = useId().replace(/:/g, '');
  const drones = s.missionState.drones;
  const selected = drones.find((d) => d.id === s.selectedDrone) ?? drones[0];
  const selectedNode = s.communicationNodes.find((n) => n.droneId === selected?.id);
  const locked = s.clusterRunning || s.clusterStarting;
  const ready = drones.filter((d) => !['STOPPED', 'STARTING', 'FAULT'].includes(d.instanceStatus)).length;
  const online = s.communicationNodes.filter((n) => n.network === '模拟在线' || n.network === '真实在线').length;
  const armed = drones.filter((d) => d.armed).length;
  const assigned = drones.filter((d) => d.assignedTaskId).length;
  const faults = drones.filter((d) => d.instanceStatus === 'FAULT').length;
  const source = [...new Set(s.communicationNodes.map((n) => n.source))].join(' / ') || '未配置';
  const status = s.stopRequested ? '等待安全停止' : s.clusterStarting ? '模拟启动中' : s.clusterRunning ? '模拟集群运行中' : s.clusterStopped ? '集群已停止' : '等待启动';
  const canContinue = s.clusterRunning && !s.clusterStarting && !s.stopRequested && drones.length === 15 && ready === 15;
  const nextHint = s.stopRequested ? '正在等待安全停止，请完成后重新启动集群。'
    : s.clusterStarting ? `正在启动模拟集群（${s.bootProgress}%），请等待全部实例就绪。`
    : faults ? `${faults} 架实例异常，请先检查节点状态。`
    : canContinue ? '15 架实例已就绪，下一步核对树莓派映射、转发与心跳。'
    : s.clusterRunning ? `当前 ${ready}/15 架实例就绪，请检查未就绪节点。`
    : '请先点击「启动集群」，等待 15 架实例全部就绪。';
  const stageIndex = s.clusterStarting ? Math.min(3, Math.floor(s.bootProgress / 25)) : -1;
  const statusLabel = (d: Drone) => d.instanceStatus === 'STOPPED' && s.clusterStopped ? '已停止' : instanceLabels[d.instanceStatus];
  // One uniform metre-to-preview scale preserves the actual row/column spacing ratio.
  const halfWidth = Math.max(20, ...drones.map((d) => Math.abs(d.homePosition.x - s.arrayLayout.centerX)));
  const halfHeight = Math.max(15, ...drones.map((d) => Math.abs(d.homePosition.y - s.arrayLayout.centerY)));
  const previewScale = Math.min(300 / (halfWidth * 2), 150 / (halfHeight * 2)) * zoom;
  const previewPoint = (d: Drone) => ({
    x: 200 + (d.homePosition.x - s.arrayLayout.centerX) * previewScale,
    y: 112 - (d.homePosition.y - s.arrayLayout.centerY) * previewScale,
  });
  const stop = () => {
    if (window.confirm('确认停止模拟集群？将先终止当前任务并等待所有无人机返航落地，再停止实例。')) s.stopCluster();
  };

  return <div ref={rootRef} className={styles.startup}>
    <div className={styles.overview}>
      <div className={styles.overviewStatus} role="status"><span className={s.clusterRunning ? styles.good : styles.accent}><Circle size={8} fill="currentColor" />{status}</span><small>实例 {ready}/15 · 通信 {online}/15 · 已解锁 {armed} · 任务占用 {assigned}</small></div>
      <div className={styles.configActions}>{s.clusterRunning ? <button type="button" className={shared.danger} disabled={s.stopRequested} onClick={stop}><Square size={14} />{s.stopRequested ? '等待安全停止' : '停止集群'}</button> : <button type="button" className={shared.primary} disabled={!s.simulationEnabled || s.clusterStarting} onClick={s.startCluster}><Play size={15} />{s.clusterStarting ? '正在启动集群' : '启动集群'}</button>}</div>
    </div>

    <div className={styles.mainGrid}>
      <section className={`${styles.panel} ${styles.configuration}`}>
        <header className={styles.panelHeader}><h3><Settings2 size={17} />启动配置</h3><span className={styles.tag}>MOCK</span></header>
        <div className={styles.configBody}>
          <div className={styles.sectionLabel}><MapPin size={14} />起飞阵列配置 <span>单位 m</span></div>
          <div className={styles.inputs}>{([['centerX', '中心 X'], ['centerY', '中心 Y'], ['columnSpacing', '列间距'], ['rowSpacing', '行间距'], ['altitude', '初始高度']] as const).map(([key, label]) => <label key={key}>{label}<input type="number" min={key === 'altitude' ? 0 : key === 'columnSpacing' || key === 'rowSpacing' ? 5 : undefined} disabled={locked} value={s.arrayLayout[key]} onChange={(e) => { if (e.target.value !== '') s.setArrayLayout({ [key]: Number(e.target.value) }); }} /></label>)}</div>
          <p className={styles.configNote}>{locked ? '运行期间阵列锁定。' : '修改阵列同步更新预览。'}初始高度不触发起飞。</p>

        </div>

      </section>

      <section className={`${styles.panel} ${styles.instances}`}>
        <header className={styles.panelHeader}><h3><Satellite size={17} />无人机实例状态</h3><span className={styles.tag}>{ready} / {drones.length} 就绪</span></header>
        <div className={styles.fleetSummary}><span><i className={styles.dotGood} />就绪 <b>{ready}</b></span><span><i className={styles.dotPending} />启动中 <b>{drones.filter((d) => d.instanceStatus === 'STARTING').length}</b></span><span><i className={styles.dotDanger} />异常 <b>{faults}</b></span><span>点击卡片查看节点</span></div>
        <div className={styles.droneGrid} aria-label="15 架无人机实例">{drones.map((d) => <button type="button" key={d.id} aria-label={`查看${d.id}启动状态`} aria-pressed={selected?.id === d.id} onClick={() => s.selectDrone(d.id)} className={`${styles.droneCard} ${selected?.id === d.id ? styles.selected : ''} ${d.instanceStatus === 'FAULT' ? styles.fault : ''}`}>
          <div className={styles.cardTop}><span className={styles.droneIcon}><Satellite size={22} /></span><b>{d.id}</b><i className={d.instanceStatus === 'FAULT' ? styles.dotDanger : d.instanceStatus === 'STARTING' ? styles.dotPending : d.instanceStatus === 'STOPPED' ? styles.dotOff : styles.dotGood} /></div>
          <div className={styles.cardStatus}><span className={styles.instanceLabel}>{statusLabel(d)}</span><div className={styles.cardFooter}><Battery size={12} /><span>{Math.round(d.battery)}%</span></div></div>
        </button>)}</div>
        <div className={styles.selectedNode}>
        <div className={styles.selectedDetail} aria-live="polite">{selected ? <><span className={styles.detailIcon}><Radio size={18} /></span><div><b>{selected.id}<span>{statusLabel(selected)}</span></b><small>{selected.raspberryPiIp} · {selectedNode?.network ?? '未连接'}</small></div><span className={styles.selectedMode}>{selected.mode}<small>{selected.armed ? '已解锁' : '未解锁'} · {selected.assignedTaskId ? '已分配任务' : '无任务分配'}</small></span></> : <p>暂无无人机资源，请返回系统感知检查配置。</p>}</div>
        {selected && <dl className={styles.nodeServices} aria-label="所选节点启动链路">
          <div><dt>Gazebo</dt><dd>{selected.gazeboStatus}</dd></div>
          <div><dt>SITL</dt><dd>{selected.sitlStatus}</dd></div>
          <div><dt>MAVLink</dt><dd>{selected.mavlinkStatus}</dd></div>
        </dl>}
        </div>
      </section>

      <section className={`${styles.panel} ${styles.preview}`}>
        <header className={styles.panelHeader}><h3><Crosshair size={17} />起飞阵列预览</h3><span className={styles.tag}>3 × 5</span></header>
        <div className={styles.mapWrap}>
          <div className={styles.mapCaption}><span>HOME / 初始位置</span><span>Y ↑</span></div>
          <svg className={styles.formation} viewBox="0 0 400 250" aria-label="3 行 5 列无人机 Home 位置预览">
            <defs><pattern id={gridId} width="24" height="24" patternUnits="userSpaceOnUse"><path d="M 24 0 L 0 0 0 24" fill="none" stroke="currentColor" strokeWidth=".7" /></pattern></defs>
            <rect width="400" height="250" fill={`url(#${gridId})`} className={styles.gridPattern} />
            <path d="M 0 112 H 400 M 200 0 V 250" className={styles.axes} /><circle cx="200" cy="112" r="88" className={styles.range} />
            {drones.map((d) => { const p = previewPoint(d); return <g key={d.id} transform={`translate(${p.x}, ${p.y})`} role="button" tabIndex={0} aria-label={`在阵列中选择${d.id}`} aria-pressed={selected?.id === d.id} onClick={() => s.selectDrone(d.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); s.selectDrone(d.id); } }} className={`${styles.mapMarker} ${selected?.id === d.id ? styles.markerSelected : ''}`}><circle r="12" /><path d="M -4 -4 L 4 4 M -4 4 L 4 -4" /><circle r="2" /><text y="26" textAnchor="middle">{d.id}</text></g>; })}
          </svg>
          <div className={styles.mapToolbar}><span>仿真坐标 · 米</span><div><button type="button" aria-label="缩小阵列预览" disabled={zoom <= .75} onClick={() => setZoom((v) => Math.max(.75, v - .1))}><Minus size={14} /></button><button type="button" aria-label="适配阵列预览" onClick={() => setZoom(1)}><Maximize2 size={14} /></button><button type="button" aria-label="放大阵列预览" disabled={zoom >= 1.2} onClick={() => setZoom((v) => Math.min(1.2, v + .1))}><Plus size={14} /></button></div></div>
        </div>
        <dl className={styles.arrayFacts}><div><dt><Crosshair size={13} aria-hidden="true" />阵列中心</dt><dd>{s.arrayLayout.centerX}, {s.arrayLayout.centerY} m</dd></div><div><dt><Ruler size={13} aria-hidden="true" />列间距 / 行间距</dt><dd>{s.arrayLayout.columnSpacing} / {s.arrayLayout.rowSpacing} m</dd></div><div><dt><MapPin size={13} aria-hidden="true" />{selected?.id ?? '选中无人机'} Home</dt><dd>{selected ? `${selected.homePosition.x}, ${selected.homePosition.y}, ${selected.homePosition.z} m` : '—'}</dd></div></dl>
        <p className={styles.previewNote}><MapPin size={14} />Home 阵列预览，非实时飞行位置。</p>
      </section>
    </div>

    <div className={styles.lowerGrid}>
      <section className={`${styles.panel} ${styles.logs}`}><header className={styles.panelHeader}><h3><Layers3 size={17} />启动进度</h3><span className={styles.subtle}>{source} · 教学模拟 <b>{s.bootProgress}%</b></span></header><div className={styles.stageOverview}>          <ol className={styles.stages} aria-label="模拟集群启动阶段">{stages.map((label, index) => {
            const done = s.bootProgress >= (index + 1) * 25;
            const active = stageIndex === index;
            return <li key={label} className={done ? styles.stageDone : active ? styles.stageActive : ''}><span>{done ? <Check size={12} /> : index + 1}</span><b>{label}</b><small>{done ? '模拟就绪' : active ? '模拟启动中' : '待启动'}</small></li>;
          })}</ol>
          <progress className={styles.bootProgress} aria-label="集群启动进度" value={s.bootProgress} max={100} /></div><details className={styles.eventDetails}><summary><Terminal size={14} />运行记录 <span>最近 {Math.min(s.events.length, 3)} 条</span></summary><div className={styles.logBody} role="log" aria-label="集群运行日志">{s.events.length ? s.events.slice(-3).reverse().map((event) => <div className={styles.logRow} key={event.id}><time>{time(event.time)}</time><span className={event.level === 'warning' ? styles.warning : event.level === 'success' ? styles.good : styles.accent}>{event.level === 'warning' ? '告警' : event.level === 'success' ? '完成' : '信息'}</span><p><b>{event.title}</b><span>{event.detail}</span></p><small>模拟</small></div>) : <div className={styles.emptyLog}><Terminal size={20} /><span>等待启动操作，运行时事件将在此记录。</span></div>}</div></details><div className={styles.logStatus}><span className={styles.accent}><Circle size={7} fill="currentColor" />{s.clusterStarting ? `当前阶段：${stages[stageIndex]}` : status}</span><span>最近心跳 {time(selectedNode?.heartbeatAt ?? null)}</span></div></section>
    </div>
    <footer className={styles.stepActions} aria-label="集群启动步骤操作">
      <button type="button" className={shared.secondary} onClick={() => s.setStep(0)}><ArrowLeft size={16} />上一步：系统感知</button>
      <div className={styles.nextStatus} aria-live="polite"><ShieldCheck size={18} /><div><b>{canContinue ? '集群就绪 · 保持待命' : s.clusterStarting ? '集群启动中' : s.stopRequested ? '安全停止中' : '启动准备'}</b><p id="startup-next-note">{nextHint}</p></div></div>
      <button type="button" className={shared.primary} disabled={!canContinue} aria-describedby="startup-next-note" onClick={() => { if (canContinue) s.setStep(2); }}>下一步：通信组网<ArrowRight size={16} /></button>
    </footer>
  </div>;
}
