import { ChevronLeft, ChevronRight, Navigation, Plus, ScanSearch, Shield, Target, Truck } from 'lucide-react';
import { useState } from 'react';
import { useCollaborationStore } from '../../../stores/collaborationStore';
import type { TaskGroup } from '../../../types/collaboration';
import styles from '../TaskCommand.module.css';

const icons = [Shield, ScanSearch, Target, Truck, Navigation];
const descriptions = ['区域覆盖 / 航线巡逻', '协同搜索 / 目标确认', '到点驻留 / 轮换监测', '航点运输 / 交付确认', '快速响应 / 分工救援'];

/** Display-only label; the lifecycle and launch validation remain owned by the store. */
export function taskDisplayStatus(group: TaskGroup) {
  if (group.runId) return group.lifecycle;
  if (group.plan) {
    if (group.plan.receipts.some(r => !r.accepted)) return '下发失败';
    return group.plan.stage === 'armed' ? '已解锁 / 待起飞' : group.plan.stage === 'uploaded' ? '已下发 / 待解锁' : '已规划';
  }
  return group.lifecycle === '配置中' && !group.points.length && !group.drones.length ? '待配置' : group.lifecycle;
}

export function TaskOverviewPanel({ open, onToggle, onSelect, onCreate, onHistory }: {
  open: boolean; onToggle: () => void; onSelect: (id: string) => void;
  onCreate: (id: string) => void; onHistory: (groupId: string, recordId: string) => void;
}) {
  const s = useCollaborationStore();
  const [tab, setTab] = useState<'current' | 'history'>('current');
  const selected = s.missionState.groups.find(g => g.id === (s.selectedTaskGroup))!;
  const type = s.missionState.tasks.find(t => t.id === selected.taskId)!.type;
  return <>
    <button className={styles.railHandle} type="button" aria-label={open ? '收起任务面板' : '展开任务面板'} aria-expanded={open} onClick={onToggle}>{open ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}<span>任务</span></button>
    {open && <aside data-map-obstruction="left" className={styles.taskRail} aria-label="五类独立任务入口">
      <header><b>任务中心</b><small>05 类任务 · 可并发模拟</small></header>
      <div className={styles.taskCards}>{s.missionState.groups.map((g, i) => {
        const Icon = icons[i]!;
        return <article key={g.id} title={descriptions[i]} data-task-card={g.id} className={s.businessView === g.id ? styles.activeCard : ''} style={{ '--task-color': g.color } as React.CSSProperties}>
          <div><Icon size={18} /><b>{s.missionState.tasks[i]!.type}</b><span data-task-status>{taskDisplayStatus(g)}</span></div>
          <p>{descriptions[i]}<strong>{g.drones.length}<small> 架参与</small></strong></p>
          <footer><small className={styles.cardCount}>{g.drones.length} 架参与</small><button type="button" onClick={() => onSelect(g.id)}>查看任务 <ChevronRight size={12} /></button><button type="button" disabled={(s.isRunning && !s.concurrentMode) || (!!g.runId && !['已完成', '已失败', '已终止'].includes(g.lifecycle))} onClick={() => onCreate(g.id)}><Plus size={12} />新建任务</button></footer>
        </article>;
      })}</div>
      <section className={styles.schedule} aria-label="任务调度详情">
        <header><b>任务调度</b><span>{s.isRunning ? `运行 ${s.runningTaskGroupIds.length} 项 · 资源占用中` : '调度待命'}</span></header>
        <div className={styles.scheduleTabs} role="tablist" aria-label="调度记录分类"><button role="tab" aria-selected={tab === 'current'} onClick={() => setTab('current')}>当前任务</button><button role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>已归档 ({s.records.length})</button></div>
        {tab === 'current' ? <div role="tabpanel">{s.concurrentMode && s.schedulerState.activeRuns.length > 0 && <div className={styles.activeDispatch} aria-label="并发任务控制">{s.schedulerState.activeRuns.map(run => {
            const group = s.missionState.groups.find(g => g.id === run.groupId);
            const label = group?.lifecycle === '待结果确认' ? '待人工确认' : group?.lifecycle === '异常' ? '异常待处置' : group?.lifecycle === '安全收尾' ? '返航中' : group?.lifecycle ?? run.status;
            return <div key={run.id} className={styles.activeDispatchRow} data-run-group={run.groupId}>
              <button type="button" onClick={() => onSelect(run.groupId)}>{run.name} · {label}</button>
              <small>{Math.round(group?.progress ?? 0)}% · {run.leases.map(l => l.droneId).join(' / ')} · {Math.round(run.elapsedSeconds)}s</small>
              <progress max="100" value={group?.progress ?? 0} aria-label={`${run.name}进度`} />
              <div>{group?.lifecycle === '执行中' && <button type="button" onClick={() => s.pauseTaskRun(run.id)}>暂停</button>}{group?.lifecycle === '暂停' && <button type="button" onClick={() => s.resumeTaskRun(run.id)}>继续</button>}{group?.lifecycle === '待结果确认' && <button type="button" onClick={() => onSelect(run.groupId)}>前往验收</button>}{group?.lifecycle === '异常' && <button type="button" onClick={() => onSelect(run.groupId)}>前往处置</button>}{group && !['安全收尾', '已完成', '已终止', '已失败'].includes(group.lifecycle) && <button type="button" onClick={() => { if (window.confirm(`终止${run.name}并等待参与机安全返航？`)) s.cancelTaskRun(run.id); }}>终止</button>}</div>
            </div>;
          })}</div>}<div className={styles.scheduleTitle}><b>{type}</b><span>{taskDisplayStatus(selected)}</span></div><p>{selected.drones.length} 架参与 · {selected.points.length} 个点位 · {Math.round(selected.progress)}%</p><progress aria-label="调度任务进度" max="100" value={selected.progress} /><dl className={styles.dispatchMetrics}><div><dt>任务名称</dt><dd>{selected.name}</dd></div><div><dt>执行高度</dt><dd>{selected.config.altitude} m</dd></div><div><dt>任务策略</dt><dd>{selected.config.strategy}</dd></div><div><dt>执行结果</dt><dd>{selected.outcome === 'success' ? '成功' : selected.outcome === 'failure' ? '失败' : selected.outcome === 'cancelled' ? '主动终止' : '待验收'}</dd></div><div><dt>运行记录</dt><dd>{selected.runId ? '已建立执行记录' : '尚未执行'}</dd></div></dl>{selected.taskId === 'task-3' && selected.execution && <div className={styles.relayDispatch} aria-label="监测接力执行队列"><b>接力执行队列 · 模拟</b>{selected.execution.aircraft.map((a, i) => <span key={a.droneId}><strong>{i + 1}. {a.droneId}</strong><small>{a.phase === 'working' && !a.completed ? `驻留剩余 ${Math.max(0, (selected.plan?.routes[i]?.stationSeconds ?? selected.config.duration) - a.dwell).toFixed(1)} s` : a.completed ? '驻留完成 / 返航' : a.phase === 'queued' ? i === 0 ? '待首机起飞' : '等待交接条件' : a.phase === 'transit' || a.phase === 'takeoff' ? '飞往监测点' : a.phase === 'failed' ? '执行失败' : '返航 / 已释放'}</small></span>)}</div>}<button type="button" onClick={() => onSelect(selected.id)}>查看调度详情 <ChevronRight size={12} /></button></div>
          : <div role="tabpanel">{s.records.length ? <div className={styles.archiveList} role="region" aria-label="全部任务归档">{[...s.records].reverse().map(record => <button key={record.id} type="button" onClick={() => onHistory(record.groupId, record.id)}><b>{record.name}</b><span>{record.group.lifecycle} · {record.group.drones.length} 架 · {Math.round(record.group.progress)}%</span><ChevronRight size={12} /></button>)}</div> : <p className={styles.scheduleEmpty}>暂无归档任务<br />执行完成后将在此保留记录</p>}</div>}
      </section>
    </aside>}
  </>;
}
