import { flightStateLabel } from '../../../domain/collaborationFlight';
import { useEffect, useRef } from 'react';
import { Battery, Radio } from 'lucide-react';
import { useCollaborationStore } from '../../../stores/collaborationStore';
import type { TaskRecord } from '../../../types/collaboration';
import styles from '../LiveCommand.module.css';
import { AircraftAttitude, AircraftIcon } from './AircraftIcon';
import { TelemetryAttitude } from './TelemetryAttitude';
import { describeTaskRole, droneAlert, instanceLabels } from '../../../domain/collaborationMission';


const connectionLabels = { DISCONNECTED: '未连接', CONNECTED: '遥测在线', STALE: '数据过期' };
const timestamp = (time: number | null) => time ? new Date(time).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 1 }) : '尚无数据';

/** Display only: all telemetry and timestamps come from the shared runtime snapshot. */
export function LiveTelemetry({ compact = false, onLocateDrone }: { compact?: boolean; onLocateDrone?: (id: string) => void }) {
  const s = useCollaborationStore();
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = scroll.current;
    const card = list?.querySelector<HTMLElement>(`[data-testid="telemetry-${s.selectedDrone}"]`);
    if (!list || !card) return;
    const bounds = list.getBoundingClientRect(), target = card.getBoundingClientRect();
    if (target.top < bounds.top || target.bottom > bounds.bottom) list.scrollTop += target.top - bounds.top - 10;
  }, [s.selectedDrone]);
  return <aside className={styles.telemetry} aria-label="实时无人机遥测列表">
    <header><div><Radio size={17} /><b>机队实时遥测</b></div><span>{s.missionState.drones.length} 架 · {s.clusterRunning ? '5 Hz 模拟推送' : '等待启动'}</span><p className={styles.telemetryHint}>卡片原位更新 · 姿态跟随飞行状态</p></header>
    <div ref={scroll} className={styles.telemetryScroll}>{s.missionState.drones.map((d) => {
      const node = s.communicationNodes.find((n) => n.droneId === d.id);
      const task = s.missionState.groups.find((g) => g.runId && g.runId === d.assignedTaskId);
      const warning = !!droneAlert(d);
      return <article key={d.id} className={`${styles.telemetryCard} ${s.selectedDrone === d.id ? styles.selected : ''} ${warning ? styles.warning : ''}`} data-testid={`telemetry-${d.id}`} data-telemetry-at={d.updatedAt}>
        <button type="button" aria-label={`定位遥测${d.id}`} aria-pressed={s.selectedDrone === d.id} onClick={() => { s.selectDrone(d.id); onLocateDrone?.(d.id); }}>
          <span className={styles.telemetryAircraft}><AircraftAttitude attitude={d.attitude} armed={d.armed} /></span><b>{d.id}<small>{d.droneType} · {d.payload}</small></b><span>{droneAlert(d) || flightStateLabel(d)}</span>
        </button>
        <div className={styles.cardLink}><span>{node?.source ?? '未提供'} · {node?.network ?? '未连接'}</span><span><Battery size={14} />{d.battery.toFixed(1)}%</span></div>
        <TelemetryAttitude droneId={d.id} attitude={d.attitude} armed={d.armed} streaming={s.clusterRunning && d.connectionStatus === 'CONNECTED' && !['STOPPED', 'STARTING', 'FAULT'].includes(d.instanceStatus)} />
        <dl>
          <div><dt>节点 IP</dt><dd>{d.raspberryPiIp}</dd></div><div><dt>连接状态</dt><dd>{connectionLabels[d.connectionStatus]}</dd></div><div><dt>飞行模式</dt><dd>{d.mode}</dd></div><div><dt>解锁状态</dt><dd>{d.armed ? '已解锁' : '未解锁'}</dd></div>
          <div><dt>仿真 X / Y</dt><dd>{d.position.x.toFixed(1)} / {d.position.y.toFixed(1)} m</dd></div><div><dt>高度</dt><dd>{d.position.z.toFixed(1)} m</dd></div><div><dt>地速 / 垂速</dt><dd>{Math.hypot(d.velocity.x, d.velocity.y).toFixed(1)} / {d.velocity.z.toFixed(1)} m/s</dd></div>
          {!compact && <div><dt>任务分工</dt><dd>{d.currentRole ? describeTaskRole(d.currentRole) : '未分配'}</dd></div>}
        </dl>
        {!compact && <p>{task?.name ?? '统一资源池 · 无当前任务'} · {connectionLabels[d.connectionStatus]}</p>}
        <footer><span>遥测 {timestamp(d.updatedAt)}</span><span>心跳 {timestamp(node?.heartbeatAt ?? null)}</span></footer>
      </article>;
    })}</div>
  </aside>;
}

export function SelectedDroneTelemetry({ snapshot }: { snapshot?: TaskRecord }) {
  const s = useCollaborationStore();
  const d = (snapshot?.drones ?? s.missionState.drones).find((item) => item.id === s.selectedDrone);
  if (!d) return <section className={styles.inspection}>点击地图或遥测卡片，查看单机详情。</section>;
  const node = s.communicationNodes.find((n) => n.droneId === d.id);
  return <section className={styles.inspection} aria-label={snapshot ? "历史无人机详情" : "选中无人机实时详情"}>
    {snapshot && <p>任务结束时快照 · 只读 · {snapshot.name}</p>}
    <h3><AircraftIcon size={18} />{d.id} <small>{instanceLabels[d.instanceStatus]}</small></h3>
    <dl><div><dt>通信节点</dt><dd>{d.raspberryPiIp}</dd></div><div><dt>数据来源</dt><dd>{snapshot ? 'Mock · 历史遥测快照' : `${node?.source ?? '未提供'} · ${node?.network ?? '未连接'}`}</dd></div>
      <div><dt>飞控 / 模式</dt><dd>{d.mavlinkStatus} / {d.mode}</dd></div><div><dt>Gazebo / SITL</dt><dd>{d.gazeboStatus} / {d.sitlStatus}</dd></div>
      <div><dt>当前位置</dt><dd>{[d.position.x, d.position.y, d.position.z].map((v) => v.toFixed(1)).join(' / ')} m</dd></div>
      <div><dt>地速 / 垂速</dt><dd>{Math.hypot(d.velocity.x, d.velocity.y).toFixed(1)} / {d.velocity.z.toFixed(1)} m/s</dd></div><div><dt>航向（北为 0°）</dt><dd>{d.attitude[2].toFixed(1)}°</dd></div>
      <div><dt>电量 / 解锁</dt><dd>{d.battery.toFixed(1)}% / {d.armed ? '已解锁' : '未解锁'}</dd></div><div><dt>数据更新时间</dt><dd>{timestamp(d.updatedAt)}</dd></div></dl>
    {!snapshot && <button type="button" disabled={!d.armed || d.instanceStatus === 'RETURNING'} onClick={() => {
      if (window.confirm(`确认让 ${d.id} 单独模拟返航？其他无人机不会自动终止，关键角色退出可能需要降级处置。`)) s.returnDrone(d.id);
    }}>单机模拟返航</button>}
    {!snapshot && <p>只控制选中无人机；真实飞控指令未接入。</p>}
  </section>;
}
