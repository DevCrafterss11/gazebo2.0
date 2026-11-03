import { useState } from 'react';
import { Activity, ArrowLeft, ArrowRight, Check, Circle, Clock3, Link2, Monitor, Network, Radio, ShieldCheck, Wifi } from 'lucide-react';
import { useCollaborationStore } from '../../stores/collaborationStore';
import type { CommunicationNode, Drone } from '../../types/collaboration';
import shared from './Collaboration.module.css';
import styles from './CommunicationNetwork.module.css';

const time = (value: number | null | undefined) => value ? new Date(value).toLocaleTimeString('zh-CN', { hour12: false }) : '未收到';
const sourceName = { Mock: 'Mock · 教学模拟', SITL: 'SITL · 软件在环', 'Raspberry Pi Relay': 'Raspberry Pi Relay · 树莓派转发', Hardware: 'Hardware · 真实硬件' };
const heartbeatWindow = 5000;

function linkStatus(drone: Drone, node: CommunicationNode | undefined, now: number) {
  if (!node) return '缺少通信节点';
  if (node.ip !== drone.raspberryPiIp) return '映射异常';
  if (node.network === '中断') return '通信中断';
  if (node.network === '未连接') return '未连接';
  if (/未接入|中断|失败/.test(node.mavlink)) return node.mavlink;
  if (!node.heartbeatAt) return '未收到心跳';
  if (now - node.heartbeatAt > heartbeatWindow || drone.connectionStatus === 'STALE') return '数据过期';
  if (drone.connectionStatus !== 'CONNECTED') return '飞控未连接';
  return '链路正常';
}

/** Communication is a view of the unified resources; it never creates connections or timers. */
export function CommunicationNetwork() {
  const s = useCollaborationStore();
  const [attentionOnly, setAttentionOnly] = useState(false);
  const drones = s.missionState.drones;
  const nodes = s.communicationNodes;
  const now = Date.now();
  const selected = drones.find(d => d.id === s.selectedDrone) ?? drones[0];
  const selectedNode = nodes.find(n => n.droneId === selected?.id);
  const online = nodes.filter(n => n.network === '模拟在线' || n.network === '真实在线').length;
  const fresh = drones.filter(d => {
    const n = nodes.find(item => item.droneId === d.id);
    return n?.heartbeatAt && now - n.heartbeatAt <= heartbeatWindow && (n.network === '模拟在线' || n.network === '真实在线');
  }).length;
  const healthy = drones.filter(d => linkStatus(d, nodes.find(n => n.droneId === d.id), now) === '链路正常').length;
  const mapping = Array.from({ length: 15 }, (_, index) => {
    const id = `uav${101 + index}`;
    const ip = `192.168.10.${101 + index}`;
    return drones.filter(d => d.id === id && d.raspberryPiIp === ip).length === 1
      && nodes.filter(n => n.droneId === id && n.ip === ip).length === 1
      && nodes.filter(n => n.ip === ip).length === 1;
  }).filter(Boolean).length;
  const attention = drones.length - healthy;
  const visibleDrones = attentionOnly ? drones.filter(d => linkStatus(d, nodes.find(n => n.droneId === d.id), now) !== '链路正常') : drones;
  const source = sourceName[s.missionState.dataSource];
  const canContinue = s.clusterRunning && !s.clusterStarting && !s.stopRequested;
  const selectedStatus = selected ? linkStatus(selected, selectedNode, now) : '等待资源';
  const nextHint = s.stopRequested ? '集群正在安全停止，请返回启动页查看状态。'
    : s.clusterStarting ? '集群启动中，请等待节点就绪。'
    : !s.clusterRunning ? '请先返回集群启动，完成节点启动。'
    : attention || mapping < 15 ? '存在需关注链路，可进入机队监控继续排查。'
    : '链路已就绪，进入机队监控查看位置和遥测。';

  return <div className={styles.network}>
    <div className={styles.overview}>
      <div><h2><Network size={19} />通信链路<span>{online} / 15 在线</span></h2><p>教学平台 → 树莓派转发节点 → 无人机 / SITL · 逐机核对数据链路</p></div>
      <span className={shared.simTag}><Circle size={8} fill="currentColor" />{source}</span>
    </div>

    <div className={styles.metrics} aria-label="通信状态汇总">
      <div><Wifi size={20} /><span>网络在线<b>{online}<small> / 15 节点</small></b></span><span className={styles.metricNote}>独立通信节点</span></div>
      <div><Activity size={20} /><span>有效心跳<b>{fresh}<small> / 15 节点</small></b></span><span className={styles.metricNote}>最近 5 秒</span></div>
      <div><Link2 size={20} /><span>一一映射<b>{mapping}<small> / 15 对</small></b></span><span className={styles.metricNote}>编号 / IP 核对</span></div>
      <div className={attention || mapping < 15 ? styles.attentionMetric : ''}><ShieldCheck size={20} /><span>链路正常<b>{healthy}<small> / {drones.length} 架</small></b></span><span className={styles.metricNote}>{attention ? `${attention} 架需关注` : '全链路状态一致'}</span></div>
    </div>

    <div className={styles.mainGrid}>
      <section className={`${styles.panel} ${styles.nodes}`} aria-label="15 架无人机通信节点">
        <header className={styles.panelHeader}><h3><Radio size={16} />通信节点矩阵</h3><div className={styles.filters} aria-label="通信节点筛选"><button type="button" aria-pressed={!attentionOnly} onClick={() => setAttentionOnly(false)}>全部节点 {drones.length}</button><button type="button" aria-pressed={attentionOnly} onClick={() => setAttentionOnly(true)}>需关注 {attention}</button></div></header>
        <div className={styles.nodeGrid}>{visibleDrones.map(drone => {
          const node = nodes.find(n => n.droneId === drone.id);
          const status = linkStatus(drone, node, now);
          const good = status === '链路正常';
          return <article key={drone.id} className={styles.nodeCard}>
            <button type="button" className={`${styles.nodeButton} ${selected?.id === drone.id ? styles.selected : ''}`} aria-label={`查看${drone.id}通信链路`} aria-pressed={selected?.id === drone.id} onClick={() => s.selectDrone(drone.id)}>
              <span className={styles.cardTop}><b>{drone.id}</b><span className={good ? styles.good : styles.warning}>{good ? <Check size={12} /> : <Circle size={10} />}{good ? node?.network : status}</span></span>
              <span className={styles.ip}><Wifi size={13} />{node?.ip ?? drone.raspberryPiIp}</span>
              <span className={styles.forwarding}><Radio size={12} />{node?.mavlink ?? '无通信节点'}</span>
              <span className={styles.heartbeat}><span>心跳 {time(node?.heartbeatAt)}</span><small>{node?.source ?? '无数据'}</small></span>
            </button>
          </article>;
        })}</div>
        {!visibleDrones.length && <div className={styles.empty}><ShieldCheck size={26} /><b>{drones.length ? '当前没有需要关注的链路' : '尚无无人机资源'}</b><span>{drones.length ? '所有已加载节点通信正常，可切换回全部节点。' : '请返回集群启动检查资源配置。'}</span>{attentionOnly && <button type="button" className={shared.secondary} onClick={() => setAttentionOnly(false)}>显示全部节点</button>}</div>}
        <div className={styles.matrixFoot}><span><Circle size={7} fill="currentColor" />点击节点查看完整链路</span><span>心跳由统一运行时更新</span></div>
      </section>

      <section className={`${styles.panel} ${styles.details}`} aria-label="选中节点链路详情">
        <header className={styles.panelHeader}><h3><Link2 size={16} />{selected?.id ?? '未选择节点'} · 链路详情</h3><span className={selectedStatus === '链路正常' ? styles.good : styles.warning}>{selectedStatus}</span></header>
        <div className={styles.chain}>
          <div><span className={styles.chainIcon}><Monitor size={18} /></span><div><b>MUVA 教学平台</b><small>{source}</small></div></div>
          <span className={styles.connector}>状态与遥测汇聚</span>
          <div><span className={styles.chainIcon}><Network size={18} /></span><div><b>树莓派通信节点</b><small>{selectedNode?.ip ?? '通信节点未接入'}</small></div></div>
          <span className={styles.connector}>{selectedNode?.mavlink ?? '转发服务未接入'}</span>
          <div><span className={styles.chainIcon}><Radio size={18} /></span><div><b>{selected?.id ?? '无人机'} / SITL</b><small>{selected?.mavlinkStatus ?? '无飞控遥测'}</small></div></div>
        </div>
        <dl className={styles.facts}>
          <div><dt><Wifi size={13} aria-hidden="true" />网络状态</dt><dd>{selectedNode?.network ?? '未连接'}</dd></div>
          <div><dt><Activity size={13} aria-hidden="true" />最近心跳</dt><dd>{time(selectedNode?.heartbeatAt)}</dd></div>
          <div><dt><Clock3 size={13} aria-hidden="true" />遥测更新</dt><dd>{time(selected?.updatedAt)}</dd></div>
          <div><dt><Radio size={13} aria-hidden="true" />Gazebo / SITL</dt><dd>{selected?.gazeboStatus ?? '未接入'} / {selected?.sitlStatus ?? '未接入'}</dd></div>
        </dl>
        <p className={styles.sourceNote}><ShieldCheck size={14} />本轮为教学模拟；真实树莓派网络检测、MAVLink 心跳接口待接入。</p>
      </section>
    </div>

    <footer className={styles.stepActions} aria-label="通信组网步骤操作">
      <button type="button" className={shared.secondary} onClick={() => s.setStep(1)}><ArrowLeft size={16} />上一步：集群启动</button>
      <div className={styles.nextStatus}><ShieldCheck size={18} /><div><b>{mapping === 15 ? '15 对资源映射正确' : `资源映射 ${mapping} / 15 · 请检查`}</b><p id="communication-next-note">{nextHint}</p></div></div>
      <button type="button" className={shared.primary} disabled={!canContinue} aria-describedby="communication-next-note" onClick={() => { if (canContinue) s.setStep(3); }}>下一步：集群状态监控<ArrowRight size={16} /></button>
    </footer>
  </div>;
}
