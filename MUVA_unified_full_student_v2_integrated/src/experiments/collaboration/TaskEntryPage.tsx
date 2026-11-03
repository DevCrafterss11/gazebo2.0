import { Activity, ArrowRight, CheckCircle2, CircleDot, Compass, MapPinned, Navigation, Radio, ScanSearch, Shield, Target, Truck, Users } from 'lucide-react';
import { useCollaborationStore } from '../../stores/collaborationStore';
import { taskTypeNames } from '../../types/collaboration';
import styles from './TaskEntryPage.module.css';

const icons = [Shield, ScanSearch, Target, Truck, Navigation];
const descriptions = [
  '规划覆盖区域，组织协同巡逻与航线复核。',
  '指定搜索范围，协作定位并确认目标。',
  '设定监测点与驻留时长，持续采集状态。',
  '配置起点与交付点，完成物资运输交接。',
  '划定救援目标，组织快速响应和安全返航。',
];
const phases = [
  { title: '选择任务', detail: '从五类任务中确定本次目标' },
  { title: '配置方案', detail: '设置参数、地图点位与无人机角色' },
  { title: '执行与复盘', detail: '在指挥台监控、处置并查看结果' },
];

/** Teaching entry, intentionally separate from the full-screen operational map. */
export function TaskEntryPage({ onOpen }: { onOpen: (groupId?: string) => void }) {
  const state = useCollaborationStore();
  const active = state.missionState.groups.find(group => group.id === state.activeGroupId);
  const ready = state.missionState.drones.filter(drone => drone.instanceStatus === 'STANDBY').length;
  const busy = state.missionState.drones.filter(drone => drone.instanceStatus === 'FLYING' || drone.instanceStatus === 'RETURNING').length;
  const online = state.communicationNodes.filter(node => node.network === '模拟在线').length;
  return <section className={styles.entry} aria-label="多任务协同教学入口">
    <div className={styles.hero}>
      <div className={styles.heroCopy}>
        <span className={styles.eyebrow}><CircleDot size={14} /> STAGE 05 / MISSION COMMAND</span>
        <h2>多无人机网页地面站指挥平台</h2>
        <p>步骤 5 是任务总览与进入区。先选择本次任务，再到全屏地面站完成地图规划、无人机编组、执行监控和安全处置。</p>
        <div className={styles.heroActions}>
          <button type="button" className={styles.primary} aria-label="展开指挥台" onClick={() => onOpen(active?.id)}><MapPinned size={18} />展开指挥台<ArrowRight size={17} /></button>
          <span><Radio size={14} /> Mock 教学模拟 · 不连接真实飞控</span>
        </div>
      </div>
      <div className={styles.heroVisual} aria-hidden="true"><div className={styles.orbit}><span><Compass size={36} /></span></div><div className={styles.visualCaption}>GROUND STATION / 05 <b>统一资源 · 独立执行</b></div></div>
    </div>
    <div className={styles.stats} aria-label="任务资源概览">
      <div><span>集群状态</span><b><i className={state.clusterRunning ? styles.online : styles.offline} />{state.clusterRunning ? '模拟运行中' : '已停止'}</b></div>
      <div><span>模拟心跳</span><b>{online}<small> / 15</small></b></div>
      <div><span>待命 / 执行</span><b>{ready}<small> / {busy} 架</small></b></div>
      <div><span>已保存记录</span><b>{state.records.length}<small> 次</small></b></div>
    </div>
    <div className={styles.content}>
      <div className={styles.catalog}>
        <header className={styles.sectionHeading}><div><span>01 / TASK LIBRARY</span><h3>选择独立任务</h3><p>默认逐项执行；开启并发调度后可在编组资源互不占用时同时模拟执行多项任务。</p></div><span className={styles.count}>05 项任务类型</span></header>
        <div className={styles.cards}>{state.missionState.groups.map((group, index) => {
          const Icon = icons[index]!;
          const isActive = active?.id === group.id;
          return <article key={group.id} className={styles.card} style={{ '--task-accent': group.color } as React.CSSProperties}>
            <div className={styles.cardTop}><span className={styles.cardIcon}><Icon size={22} /></span><span className={styles.cardIndex}>0{index + 1}</span></div>
            <h4>{taskTypeNames[index]}</h4><p>{descriptions[index]}</p>
            <div className={styles.cardBottom}><span>{isActive ? '正在执行' : group.lifecycle}</span><button type="button" onClick={() => onOpen(group.id)} aria-label={`进入${taskTypeNames[index]}指挥台`}>进入指挥台<ArrowRight size={16} /></button></div>
          </article>;
        })}</div>
      </div>
      <aside className={styles.guide} aria-label="任务指挥引导">
        <span className={styles.guideEyebrow}>02 / WORKFLOW</span><h3>从规划到复盘</h3><p>教学页面保留全局脉络，操作在独立工作区进行。返回这里不会结束正在运行的任务。</p>
        <ol>{phases.map((phase, index) => <li key={phase.title}><span>{index === 0 ? <CheckCircle2 size={18} /> : index === 1 ? <Users size={18} /> : <Activity size={18} />}</span><div><b>{phase.title}</b><small>{phase.detail}</small></div></li>)}</ol>
        <div className={styles.guideNote}><Target size={17} /><span>{active ? `当前：${active.name} · ${active.lifecycle}。可返回指挥台继续操作。` : '选择上方任务即可直达其指挥工作区。'}</span></div>
      </aside>
    </div>
  </section>;
}
