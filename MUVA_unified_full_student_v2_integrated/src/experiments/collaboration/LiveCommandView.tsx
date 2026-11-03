import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Crosshair, Radio, Settings2, X } from 'lucide-react';
import { useCollaborationStore } from '../../stores/collaborationStore';
import { flightStateLabel } from '../../domain/collaborationFlight';
import { FleetMap } from './components/FleetMap';
import { LiveTelemetry } from './components/LiveTelemetry';
import { FlightControls } from './components/FlightControls';
import { ResourceManager } from './components/ResourceManager';
import styles from './LiveCommand.module.css';

/** Fleet telemetry surface, intentionally separate from the task configuration workspace. */
export function LiveCommandView({ onClose }: { onClose: () => void }) {
  const s = useCollaborationStore();
  const dialog = useRef<HTMLDialogElement>(null);
  const [resources, setResources] = useState(false);
  const [panelOpen, setPanelOpen] = useState(() => !window.matchMedia('(max-width: 900px)').matches);
  const [cameraRequest, setCameraRequest] = useState(0);
  const [locateRequest, setLocateRequest] = useState(0);
  const selected = s.missionState.drones.find(d => d.id === s.selectedDrone);
  const current = s.missionState.groups.find(g => g.id === s.activeGroupId);
  const lastReceipt = s.flightCommands.filter(r => r.droneId === selected?.id).at(-1);
  const canReturn = !!selected?.armed && selected.instanceStatus !== 'RETURNING';
  const displayedRoute = current ?? s.records.at(-1)?.group;
  const selectedRoute = selected?.flightControl?.route ?? displayedRoute?.plan?.routes.find(r => r.droneId === selected?.id)?.waypoints ?? displayedRoute?.points ?? [];
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.showModal();
    const narrow = window.matchMedia('(max-width: 900px)');
    const collapse = () => { if (narrow.matches) setPanelOpen(false); };
    narrow.addEventListener('change', collapse);
    return () => { document.body.style.overflow = before; narrow.removeEventListener('change', collapse); };
  }, []);
  const returnSelected = () => {
    if (selected && canReturn && window.confirm(`确认让 ${selected.id} 单独模拟返航？其他无人机不受影响，关键角色退出可能需要处置。`)) s.returnDrone(selected.id);
  };
  return createPortal(<dialog ref={dialog} className={styles.dialog} aria-label="集群实时指挥视图" onCancel={e => { e.preventDefault(); onClose(); }}>
    <section className={styles.liveSurface} aria-label="集群遥测与飞行操作">
      <LiveTelemetry compact onLocateDrone={() => setLocateRequest(n => n + 1)} />
      <div className={styles.liveMap} data-command-stage>
        <FleetMap global commandIcons locked presentation="live" cameraRequest={cameraRequest} locateRequest={locateRequest} frameKey={`live-${panelOpen}`} onInspectDrone={() => setPanelOpen(true)} onMapToolsOpen={() => setPanelOpen(false)} onPopupOpen={() => { if (window.matchMedia('(max-width: 900px)').matches) setPanelOpen(false); }} />
        <div className={styles.mapHeading} data-map-top><Radio size={15} /><b>集群实时视图</b><span>Mock 位置 · WGS84 / ENU</span><span>{s.communicationNodes.filter(n => n.network === '模拟在线').length}/15 心跳</span></div>
        <div className={styles.mapActions} data-map-top><button type="button" aria-label="无人机资源管理" title="无人机资源管理" onClick={() => setResources(true)}><Settings2 size={17} /></button><button type="button" aria-expanded={panelOpen} onClick={() => setPanelOpen(!panelOpen)}>{panelOpen ? '收起操作' : '飞行操作'}</button><button type="button" onClick={onClose}><X size={16} />返回任务工作区</button></div>
        {panelOpen && <aside className={styles.flightPanel} data-map-obstruction="right" aria-label="飞行操作面板">
          <header><b>飞行操作</b><select aria-label="选中操作无人机" value={selected?.id ?? ''} onChange={e => s.selectDrone(e.target.value)}>{s.missionState.drones.map(d => <option key={d.id} value={d.id}>{d.id}</option>)}</select></header>
          <div className={styles.panelScroll}>
            {lastReceipt && <p className={styles.capability} role="status" data-latest-command={lastReceipt.status}>{lastReceipt.status === 'pending' ? '等待模拟飞控回执…' : lastReceipt.detail}</p>}
            <section><h3>地图设置</h3><div className={styles.controlRow}><button type="button" onClick={() => setCameraRequest(n => n + 1)}>地图自适应</button><button type="button" disabled={!selected} onClick={() => setLocateRequest(n => n + 1)}><Crosshair size={13} />定位选中机</button></div></section>
            <section><h3>飞控状态</h3><dl className={styles.flightState}><div><dt>通信节点</dt><dd>{selected?.raspberryPiIp ?? '—'}</dd></div><div><dt>运行状态</dt><dd>{selected ? flightStateLabel(selected) : '—'}</dd></div><div><dt>模式 / 解锁</dt><dd>{selected ? `${selected.mode} / ${selected.armed ? '已解锁' : '未解锁'}` : '—'}</dd></div><div><dt>位置 X / Y / Z</dt><dd>{selected ? [selected.position.x, selected.position.y, selected.position.z].map(v => v.toFixed(1)).join(' / ') : '—'} m</dd></div><div><dt>姿态 R / P / Y</dt><dd>{selected?.attitude.map(v => v.toFixed(1)).join(' / ') ?? '—'} °</dd></div><div><dt>地速 / 垂速</dt><dd>{selected ? `${Math.hypot(selected.velocity.x, selected.velocity.y).toFixed(1)} / ${selected.velocity.z.toFixed(1)}` : '—'} m/s</dd></div><div><dt>电量</dt><dd>{selected?.battery.toFixed(1) ?? '—'}%</dd></div></dl></section>
            {current && <section><h3>执行控制</h3><div className={styles.controlRow}><button type="button" disabled={!s.isRunning || s.isPaused || current?.lifecycle !== '执行中'} onClick={s.pauseExecution}>暂停</button><button type="button" disabled={!s.isPaused || current?.lifecycle === '异常'} onClick={s.resumeExecution}>继续</button><button type="button" disabled={!s.isRunning || current?.lifecycle === '安全收尾'} onClick={() => { if (window.confirm('确认终止当前执行并安全返航？')) s.terminateExecution(); }}>终止并返航</button></div><p className={styles.executionState}>{current ? `${current.lifecycle} · ${Math.round(current.progress)}%` : '无正在执行的任务'}</p>{s.notice && <p role="status" className={styles.capability}>{s.notice}</p>}</section>}
            {selected && <FlightControls key={selected.id} drone={selected} onReturn={returnSelected} canReturn={canReturn} />}

            <section><h3>航点与轨迹 <small>只读 · 来自共享运行时</small></h3><label className={styles.coordinateLabel}>计划航点 / 本地坐标<textarea aria-label="实时视图计划航点" readOnly value={selectedRoute.length ? selectedRoute.map((p, i) => `${i + 1}. ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`).join('\n') : '暂无执行航线'} /></label><label className={styles.coordinateLabel}>选中无人机实际轨迹<textarea aria-label="实时视图实际轨迹" readOnly value={selected?.trajectory.length ? selected.trajectory.slice(-6).map(p => `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`).join('\n') : '暂无飞行轨迹'} /></label></section>
          </div>
        </aside>}
      </div>
    </section>
    {resources && <ResourceManager onClose={() => setResources(false)} />}
  </dialog>, document.body);
}
