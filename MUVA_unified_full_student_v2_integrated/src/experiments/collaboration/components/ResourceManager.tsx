import { useEffect, useRef, useState } from 'react';
import { Camera, Eye, Package, Radio, Truck, X } from 'lucide-react';
import { dronePayloadNames, droneTypeNames, type Drone, type DronePayload, type DroneType, type TaskGroup, type TaskType } from '../../../types/collaboration';
import { assignmentEligibility, seatGaps } from '../../../domain/collaborationMission';
import { pickSeat, seatNeed, seatRequirements, seatsFor } from '../../../domain/collaborationResources';
import { useCollaborationStore } from '../../../stores/collaborationStore';
import styles from './ResourceManager.module.css';

type View = 'task' | 'drone';
interface Loadout { droneType: DroneType; payload: DronePayload }
const typeClass: Record<DroneType, string> = { '侦察': styles.recon!, '运输': styles.transport!, '中继': styles.relay! };
const TypeIcon = ({ type }: { type: DroneType }) => type === '侦察' ? <Eye aria-hidden="true" /> : type === '运输' ? <Truck aria-hidden="true" /> : <Radio aria-hidden="true" />;
const PayloadIcon = ({ payload }: { payload: DronePayload }) => payload === '摄像头' ? <Camera aria-hidden="true" /> : <Package aria-hidden="true" />;

function Kinds({ drone }: { drone: Pick<Drone, 'droneType' | 'payload'> }) {
  return <span className={styles.kinds}><span className={`${styles.chip} ${styles.type} ${typeClass[drone.droneType]}`}><TypeIcon type={drone.droneType} />{drone.droneType}</span>
    <span className={styles.chip}><PayloadIcon payload={drone.payload} />{drone.payload}</span></span>;
}
const stateText = (d: Drone) => d.instanceStatus === 'STANDBY' ? '待命' : d.instanceStatus === 'FLYING' ? '执行中' : d.instanceStatus === 'RETURNING' ? '返航中' : d.instanceStatus === 'FAULT' ? '故障' : d.instanceStatus === 'STARTING' ? '启动中' : '未启动';
function State({ drone }: { drone: Drone }) {
  return <span className={styles.state}><span className={styles.bar}><i style={{ width: `${Math.max(0, Math.min(100, drone.battery))}%` }} /></span>{Math.round(drone.battery)}% · {stateText(drone)}</span>;
}

/** Closest fix for a drone that cannot sit in this task: the primary seat's type and payload. */
function suggestedLoadout(type: TaskType): Loadout {
  const primary = seatRequirements[type].find(seat => seat.primary)!;
  return { droneType: primary.type, payload: primary.payload ?? '摄像头' };
}

function EditPanel({ drone, draft, onDraft, onApply, onCancel }: { drone: Drone; draft: Loadout; onDraft(next: Loadout): void; onApply(): void; onCancel(): void }) {
  const s = useCollaborationStore();
  const changed = draft.droneType !== drone.droneType || draft.payload !== drone.payload;
  const effects: string[] = [];
  s.missionState.groups.forEach((g, i) => {
    const type = s.missionState.tasks[i]!.type as TaskType;
    if (!g.drones.includes(drone.id) || !['配置中', '待确认'].includes(g.lifecycle) || g.runId) return;
    const seats = seatsFor(draft, type);
    const role = g.roles[drone.id] ?? '';
    if (!seats.length) effects.push(`退出「${type}」（原岗位：${role}）`);
    else if (!seats.some(seat => seat.role === role)) effects.push(`「${type}」岗位改为${seats[0]!.role}`);
  });
  return <div className={styles.edit} role="group" aria-label={`改装 ${drone.id}`}>
    <h4>改装 {drone.id}（全局生效，会影响它在其他任务里的资格）</h4>
    <div className={styles.cols}>
      <fieldset><legend>无人机类型</legend>{droneTypeNames.map(t => <label key={t}><input type="radio" name={`type-${drone.id}`} checked={draft.droneType === t} onChange={() => onDraft({ ...draft, droneType: t })} /><TypeIcon type={t} />{t}</label>)}</fieldset>
      <fieldset><legend>载荷</legend>{dronePayloadNames.map(p => <label key={p}><input type="radio" name={`payload-${drone.id}`} checked={draft.payload === p} onChange={() => onDraft({ ...draft, payload: p })} /><PayloadIcon payload={p} />{p}</label>)}</fieldset>
    </div>
    <div className={`${styles.impact} ${effects.length ? styles.impactWarn : ''}`} role="status">
      {!changed ? '选择新的类型或载荷。侦察 + 抛投器这类组合允许存在，但多数岗位会拒绝它。' : effects.length ? <>确认后将：<ul>{effects.map(e => <li key={e}>{e}</li>)}</ul></> : '不影响其他任务草稿。'}
    </div>
    <div className={styles.editFoot}><button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onCancel}>取消</button><button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={!changed} onClick={onApply}>确认改装</button></div>
  </div>;
}

export function ResourceManager({ onClose }: { onClose(): void }) {
  const s = useCollaborationStore();
  const dialog = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<View>('task');
  const [taskId, setTaskId] = useState(s.selectedTaskGroup);
  const [editing, setEditing] = useState<{ id: string; draft: Loadout } | null>(null);
  const groups = s.missionState.groups, drones = s.missionState.drones;
  const taskTypes = s.missionState.tasks.map(t => t.type as TaskType);
  const index = Math.max(0, groups.findIndex(g => g.id === taskId));
  const group = groups[index]!, type = taskTypes[index]!;
  const finished = (g: TaskGroup) => ['已完成', '已失败', '已终止'].includes(g.lifecycle);
  const groupLocked = (g: TaskGroup) => (s.isRunning && !s.concurrentMode) || !!g.runId && !finished(g) || finished(g);
  const droneLocked = (d: Drone) => s.isRunning && !s.concurrentMode || !!d.assignedTaskId || d.armed;
  const runningGroup = groups.find(g => g.id === s.activeGroupId);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);

  const counts = { type: { '侦察': 0, '运输': 0, '中继': 0 } as Record<DroneType, number>, payload: { '摄像头': 0, '抛投器': 0 } as Record<DronePayload, number> };
  drones.forEach(d => { counts.type[d.droneType]++; counts.payload[d.payload]++; });
  const otherDrafts = (id: string, except: string) => groups.filter(g => g.id !== except && !g.runId && g.drones.includes(id)).map(g => taskTypes[groups.indexOf(g)]!);
  const claimedElsewhere = (id: string, except: string) => s.concurrentMode && otherDrafts(id, except).length > 0;
  const startEdit = (d: Drone, draft?: Loadout) => setEditing(editing?.id === d.id ? null : { id: d.id, draft: draft ?? { droneType: d.droneType, payload: d.payload } });
  const apply = () => { if (editing && s.reconfigureDrone(editing.id, editing.draft)) setEditing(null); };
  const editBlock = (d: Drone) => editing?.id === d.id ? <EditPanel drone={d} draft={editing.draft} onDraft={draft => setEditing({ id: d.id, draft })} onApply={apply} onCancel={() => setEditing(null)} /> : null;

  const lockText = (d: Drone) => {
    const owner = groups.find(g => g.runId && g.runId === d.assignedTaskId) ?? groups.find(g => g.plan?.id === d.assignedTaskId);
    return `占用中：${owner ? taskTypes[groups.indexOf(owner)] : '任务'}${owner?.lifecycle === '待确认' ? '部署中' : '正在执行'}（落地后自动释放）`;
  };
  // Mirrors what setTaskDrone accepts besides the seat rule: a drone that is faulty or unavailable cannot be added.
  const unavailable = (d: Drone) => !d.available || d.instanceStatus === 'FAULT' || d.armed || !!d.assignedTaskId || (s.concurrentMode && s.clusterRunning && (d.instanceStatus !== 'STANDBY' || d.connectionStatus !== 'CONNECTED' || d.battery < 20));

  const joinRow = (d: Drone) => {
    const others = otherDrafts(d.id, group.id), role = pickSeat(d, type, group.drones.map(id => group.roles[id] ?? ''));
    return <div key={d.id} className={styles.row}><span className={styles.id}>{d.id}<small>{others.length ? '在其他草稿' : '空闲'}</small></span><Kinds drone={d} /><State drone={d} />
      <span className={styles.note}>{others.length ? `已在草稿：${others.join('、')}（并发编组不可重复）` : `加入后担任：${role}`}</span>
      <span className={styles.acts}><button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={groupLocked(group)} aria-label={`加入 ${d.id} 为${role}`} onClick={() => s.setTaskDrone(group.id, d.id, true)}>加入为 {role}</button></span></div>;
  };
  const blockedRow = (d: Drone) => {
    const lock = droneLocked(d) && !!d.assignedTaskId;
    const fit = seatsFor(d, type).length > 0;
    const reason = lock ? lockText(d) : claimedElsewhere(d.id, group.id) ? `已在其他任务草稿：${otherDrafts(d.id, group.id).join('、')}；请先从原草稿移出` : assignmentEligibility(d, type) || (d.instanceStatus === 'FAULT' ? '飞机故障' : '飞机暂不可用');
    const fix = suggestedLoadout(type);
    return <div key={d.id} className={`${styles.row} ${lock ? styles.rowLocked : ''}`}><span className={styles.id}>{d.id}<small>{lock ? '占用中' : fit ? '暂不可用' : '不符合岗位'}</small></span><Kinds drone={d} /><State drone={d} />
      <span className={`${styles.note} ${lock ? styles.noteLock : styles.noteBad}`}>{reason}</span>
      <span className={styles.acts}>{!lock && !fit && <button type="button" className={styles.btn} disabled={groupLocked(group) || droneLocked(d)} aria-expanded={editing?.id === d.id} aria-label={`改装 ${d.id} 为${fix.droneType}·${fix.payload}`} onClick={() => startEdit(d, fix)}>改装为 {fix.droneType}·{fix.payload}</button>}</span>
      {editBlock(d)}</div>;
  };

  /* ---------- 按任务 ---------- */
  const taskBody = () => {
    const members = group.drones.map(id => drones.find(d => d.id === id)).filter((d): d is Drone => !!d);
    const rest = drones.filter(d => !group.drones.includes(d.id));
    const joinable = rest.filter(d => !droneLocked(d) && !unavailable(d) && !claimedElsewhere(d.id, group.id) && !assignmentEligibility(d, type));
    const blocked = rest.filter(d => !joinable.includes(d));
    const gaps = group.drones.length ? seatGaps(type, group) : ['还没有选择参与飞机'];
    const locked = groupLocked(group);
    return <>
      {locked && <p className={`${styles.banner} ${styles.bannerLock}`}>{finished(group) ? `「${type}」已结束：本页只读，请回到指挥台新建任务后再编辑。` : '当前任务正在执行或返航，不能更改其成员；其他任务仍可配置空闲资源。'}</p>}
      <section className={styles.need} aria-label="本任务岗位需求">
        <div className={styles.needHead}><h3>{type} · 岗位需求</h3><span>当前策略：{group.config.strategy}{type === '目标搜索' ? ` · ${group.config.confirmation}` : ''}（在任务参数中修改）</span></div>
        <div className={styles.seats}>{seatRequirements[type].map(seat => {
          const n = members.filter(d => group.roles[d.id] === seat.role).length;
          return <div key={seat.role} className={`${styles.seat} ${n ? styles.seatFilled : ''}`}><div><b>{seat.primary ? '★ ' : ''}{seat.role}</b><small>需要：{seatNeed(seat)}</small></div><span className={styles.seatCount} aria-label={`${seat.role}已有 ${n} 架`}>{n}</span></div>;
        })}</div>
        <p className={`${styles.gap} ${gaps.length ? styles.gapBad : styles.gapGood}`} role="status">{gaps.length ? `缺口：${gaps.join('；')}` : '编组完整，可以回到指挥台生成航线。'}</p>
      </section>
      <section className={styles.group}><h3 className={styles.groupTitle}>已加入本任务 <em>{members.length}</em></h3><div className={styles.rows}>
        {members.length ? members.map(d => {
          const lock = droneLocked(d) && !!d.assignedTaskId, others = otherDrafts(d.id, group.id), seats = seatsFor(d, type);
          return <div key={d.id} className={`${styles.row} ${styles.rowMember} ${lock ? styles.rowLocked : ''}`}>
            <span className={styles.id}>{d.id}<small>已加入</small></span><Kinds drone={d} /><State drone={d} />
            <span className={`${styles.note} ${lock ? styles.noteLock : ''}`}>{lock ? lockText(d) : others.length ? `同时也在草稿：${others.join('、')}` : seats.length > 1 ? '可在多个岗位间切换' : '只能担任此岗位'}</span>
            <span className={styles.acts}>
              <select className={styles.select} aria-label={`${d.id} 的岗位`} value={group.roles[d.id] ?? ''} disabled={locked || lock} onChange={e => s.setTaskDroneRole(group.id, d.id, e.target.value)}>{seats.map(seat => <option key={seat.role} value={seat.role}>{seat.role}</option>)}</select>
              <button type="button" className={`${styles.btn} ${styles.btnDanger}`} disabled={locked || lock} aria-label={`将 ${d.id} 移出${type}`} onClick={() => s.setTaskDrone(group.id, d.id, false)}>移出</button>
            </span></div>;
        }) : <p className={styles.banner}>还没有飞机。从下面的「可加入」里选择。</p>}
      </div></section>
      <section className={styles.group}><h3 className={styles.groupTitle}>可加入 <em>{joinable.length}</em></h3><div className={styles.rows}>
        {joinable.slice(0, 3).map(joinRow)}
        {!joinable.length && <p className={styles.banner}>没有可直接加入的飞机。展开下面的「不可加入」，按提示改装。</p>}
      </div>
      {joinable.length > 3 && <details className={styles.more}><summary>再显示 {joinable.length - 3} 架可加入</summary><div className={styles.rows}>{joinable.slice(3).map(joinRow)}</div></details>}</section>
      <details className={`${styles.group} ${styles.more}`} open={!joinable.length || !!editing}><summary>不可加入 <em>{blocked.length}</em>（每架都写明原因，不会无声置灰）</summary><div className={styles.rows}>{blocked.map(blockedRow)}</div></details>
    </>;
  };

  /* ---------- 按无人机顺序 ---------- */
  const droneBody = () => <>
    <p className={styles.banner}>按编号顺序查看全部 {drones.length} 架飞机。右侧列出五个任务：实心表示已入编（点击移出），虚线表示可加入（点击加入），点线表示不适配并写明原因。点「改装」可修改类型和载荷。</p>
    {runningGroup && <p className={`${styles.banner} ${styles.bannerLock}`}>「{taskTypes[groups.indexOf(runningGroup)]}」正在执行：其成员被占用，不能移出或改装。</p>}
    <div className={styles.dHead} aria-hidden="true"><span>编号</span><span>类型 · 载荷</span><span>状态</span><span>参与任务（点击加入 / 移出）</span><span /></div>
    <div className={styles.dList}>{drones.map(d => {
      const lock = droneLocked(d) && !!d.assignedTaskId, joined = groups.filter(g => g.drones.includes(d.id)).length;
      return <div key={d.id} className={`${styles.dRow} ${joined ? styles.dRowHas : ''}`}><span className={styles.id}>{d.id}<small>{lock ? '占用中' : joined ? `已入编 ${joined} 个任务` : '未入编'}</small></span><Kinds drone={d} /><State drone={d} />
        <span className={styles.tchips}>{groups.map((g, i) => {
          const t = taskTypes[i]!, role = g.roles[d.id], locked = groupLocked(g) || lock;
          if (g.drones.includes(d.id)) return <button key={g.id} type="button" className={`${styles.tchip} ${styles.tchipOn}`} disabled={locked} aria-label={`将 ${d.id} 移出${t}`} title={locked ? '任务执行中或已结束，不能修改' : '点击移出'} onClick={() => s.setTaskDrone(g.id, d.id, false)}>{t} · {role}{locked ? '' : ' ✕'}</button>;
          const reason = assignmentEligibility(d, t);
          if (!reason && !unavailable(d) && !claimedElsewhere(d.id, g.id)) {
            const seat = pickSeat(d, t, g.drones.map(x => g.roles[x] ?? ''));
            return <button key={g.id} type="button" className={styles.tchip} disabled={locked} aria-label={`加入 ${d.id} 为${t} ${seat}`} title={`加入后担任：${seat}`} onClick={() => s.setTaskDrone(g.id, d.id, true)}>+ {t}</button>;
          }
          const short = reason || (claimedElsewhere(d.id, g.id) ? '已在其他任务草稿，须使用独立编组' : '飞机暂不可用');
          return <span key={g.id} className={`${styles.tchip} ${styles.tchipNo}`} tabIndex={0} title={short} aria-label={`${t}不可加入：${short}`}>{t} · {!reason ? '暂不可用' : reason.includes('载荷') ? '载荷不符' : '类型不符'}</span>;
        })}</span>
        <span className={styles.acts}><button type="button" className={styles.btn} disabled={droneLocked(d)} aria-expanded={editing?.id === d.id} title={droneLocked(d) ? '任务执行中，不能改装' : undefined} onClick={() => startEdit(d)}>{editing?.id === d.id ? '收起' : '改装'}</button></span>
        {editBlock(d)}</div>;
    })}</div>
  </>;

  return <dialog ref={dialog} className={styles.hub} aria-label="无人机资源管理" onCancel={e => { e.preventDefault(); e.stopPropagation(); if (editing) setEditing(null); else onClose(); }}>
    <header className={styles.top}><div><h2>无人机资源管理</h2><p>可分别预配置五项任务：并发模式中每架飞机只能属于一个未执行草稿。类型和载荷决定飞机能坐哪个岗位。</p></div>
      <button type="button" className={styles.close} aria-label="关闭资源管理" onClick={onClose}><X aria-hidden="true" /></button></header>
    <div className={styles.fleet} aria-label="机队概况">
      {droneTypeNames.map(t => <span key={t} className={`${styles.chip} ${styles.type} ${typeClass[t]}`}><TypeIcon type={t} />{t} {counts.type[t]}</span>)}
      {dronePayloadNames.map(p => <span key={p} className={styles.chip}><PayloadIcon payload={p} />{p} {counts.payload[p]}</span>)}
      <span className={styles.chip}>共 {drones.length} 架</span></div>
    <div className={styles.viewbar}><div className={styles.seg} role="group" aria-label="查看方式">
      <button type="button" aria-pressed={view === 'task'} onClick={() => { setView('task'); setEditing(null); }}>按任务配置</button>
      <button type="button" aria-pressed={view === 'drone'} onClick={() => { setView('drone'); setEditing(null); }}>按无人机顺序</button></div>
      <span className={styles.hint}>{view === 'drone' ? '一架飞机一行：并发编组不可重复，查看各任务岗位，也可以直接加入、移出或改装。' : '一个页签一个任务：看这个任务需要什么岗位，再挑选飞机。'}</span></div>
    {view === 'task' && <div className={styles.tabs} role="tablist" aria-label="按任务配置" onKeyDown={e => {
      const n = groups.length, next = e.key === 'ArrowRight' ? (index + 1) % n : e.key === 'ArrowLeft' ? (index + n - 1) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
      if (next < 0) return; e.preventDefault(); setTaskId(groups[next]!.id); setEditing(null);
      requestAnimationFrame(() => dialog.current?.querySelector<HTMLElement>(`#hub-tab-${groups[next]!.id}`)?.focus());
    }}>{groups.map((g, i) => {
      const gaps = g.drones.length ? seatGaps(taskTypes[i]!, g) : ['未选择'];
      return <button key={g.id} id={`hub-tab-${g.id}`} type="button" role="tab" className={styles.tab} aria-selected={g.id === group.id} tabIndex={g.id === group.id ? 0 : -1} onClick={() => { setTaskId(g.id); setEditing(null); }}>
        {taskTypes[i]}<span className={styles.count} aria-label={`已加入 ${g.drones.length} 架`}>{g.drones.length}</span>
        {s.activeGroupId === g.id ? <span className={styles.running}>执行中</span> : <span className={`${styles.dot} ${gaps.length ? styles.dotWarn : styles.dotOk}`} title={gaps.length ? '编组有缺口' : '编组完整'} />}</button>;
    })}</div>}
    <div className={styles.body} role={view === 'task' ? 'tabpanel' : 'region'} aria-label={view === 'task' ? `${type}配置` : '按无人机顺序'}>{view === 'task' ? taskBody() : droneBody()}</div>
    <footer className={styles.foot}><div><p className={styles.footMsg} role="status" aria-live="polite">{s.notice || s.preferenceStatus}</p><small>仅教学模拟，不连接真实飞控。改动参与飞机后需重新生成相关航线。</small></div>
      <div className={styles.footBtns}><button type="button" className={styles.btn} disabled={s.clusterRunning || s.clusterStarting} title={s.clusterRunning ? '集群运行中，停止后才能恢复初始配置' : undefined} onClick={() => { s.restoreDefaultPreferences(); setEditing(null); }}>恢复初始编组配置</button>
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onClose}>完成配置</button></div></footer>
  </dialog>;
}
