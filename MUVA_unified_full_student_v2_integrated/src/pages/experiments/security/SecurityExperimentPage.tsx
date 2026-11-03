import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Activity, ArrowLeft, ArrowRight, ClipboardList, Crosshair, MapPinned, Waypoints, Radio, RotateCcw, ScanSearch, Shield, ShieldAlert, Target, Truck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { services } from '../../../services/serviceRegistry';
import type { ScenarioNode } from '../../../services/contracts/securityScenario';
import { scenarios, type ScenarioId, type ScenarioPhase } from './scenarios';
import { SecurityScene } from './SecurityScene';
import styles from './SecurityExperimentPage.module.css';

const icons = [Shield, ScanSearch, Activity, Truck, Crosshair];
const phaseNames: Record<ScenarioPhase, string> = { baseline: '正常基线', attacked: '攻击影响', protected: '防护复测' };
const actionNames = { attack: '开始攻击', protect: '启用防护复测', restore: '恢复正常基线' } as const;
type Action = keyof typeof actionNames;
type Event = { id: number; scenario: ScenarioId; time: string; text: string };
const initialPhases = Object.fromEntries(scenarios.map(item => [item.id, 'baseline'])) as Record<ScenarioId, ScenarioPhase>;

export function SecurityExperimentPage() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ScenarioId>('patrol');
  const [phases, setPhases] = useState(initialPhases);
  const [events, setEvents] = useState<Event[]>([]);
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [nodes, setNodes] = useState<ScenarioNode[]>([]);
  const launcher = useRef<HTMLButtonElement>(null);
  const openOnce = useRef(false);
  const operation = useRef(false);
  const scenario = scenarios.find(item => item.id === selected)!;
  const phase = phases[selected];
  const scenarioEvents = events.filter(event => event.scenario === selected);

  useEffect(() => {
    let active = true;
    setNodes([]);
    void services.securityScenario.getNodes(selected).then(value => { if (active) setNodes(value); }).catch(() => { if (active) setError('无法读取节点状态'); });
    return () => { active = false; };
  }, [selected]);
  useEffect(() => {
    if (open) openOnce.current = true;
    else if (openOnce.current) launcher.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [open]);

  async function act(action: Action) {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError('');
    try {
      const next = await services.securityScenario.transition(selected, phase, action);
      setPhases(current => ({ ...current, [selected]: next }));
      setEvents(current => [{ id: Date.now() + Math.random(), scenario: selected, time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), text: `${actionNames[action]}：${scenario.notes[next]}` }, ...current].slice(0, 50));
    } catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败'); }
    finally { operation.current = false; setBusy(false); }
  }

  return <>
    <main className={styles.entry} aria-label="安全攻防实验介绍">
      <div className={styles.eyebrow}>EXPERIMENT 04 / SECURITY LAB</div>
      <div className={styles.intro}><div className={styles.introText}>
        <span className={styles.kicker}><ShieldAlert size={17} />安全攻防对抗 · 三机协同任务</span>
        <h1>任务安全攻防实验</h1>
        <p className={styles.lead}>在三机协同任务中实施攻击，观察航线、任务数据和执行结果的变化，并验证防护效果。</p>
        <p>围绕巡逻、搜索、监测、运输与救援五类任务，比较正常基线、攻击影响和防护复测。每项任务独立操作，结果和关键事件随场景保留。</p>
        <div className={styles.entryActions}><button ref={launcher} className={styles.primary} onClick={() => setOpen(true)}><MapPinned size={19} />进入实验<ArrowRight size={17} /></button><Link className={styles.rangeButton} to="/experiments/security/range"><Waypoints size={19} />简易靶场<ArrowRight size={17} /></Link><span>五任务为演示模式 · 简易靶场使用独立 SITL</span></div>
      </div><div className={styles.introVisual} aria-hidden="true"><span className={styles.visualHead}>SECURITY / 05 SCENARIOS</span><div className={styles.visualLine}><i /><i /><i /></div><b>任务 → 攻击 → 防护</b><small>三机编组 · 五项对照实验</small></div></div>
      <div className={styles.introDetails}>
        <section><span>01 / 实验内容</span><h2>五类任务攻击</h2><p>分区篡改、假目标、数据冻结、交付点替换与优先级欺骗，逐项观察任务后果。</p></section>
        <section><span>02 / 操作流程</span><h2>基线 · 攻击 · 复测</h2><p>选场景 → 开始攻击 → 对比影响 → 启用防护复测；可恢复基线反复练习。</p></section>
        <section><span>03 / 运行环境</span><h2>独立演示数据</h2><p>无需启动实验三、SITL 或设备。树莓派节点为预留映射，不代表已连接。</p></section>
      </div>
    </main>
    {open && createPortal(<div className={styles.workspace} role="dialog" aria-modal="true" aria-label="任务安全攻防实验工作区">
      <header className={styles.toolbar}><button className={styles.back} onClick={() => setOpen(false)}><ArrowLeft size={17} />返回实验介绍</button><span className={styles.toolbarDivider} /><div className={styles.toolbarTitle}><ShieldAlert size={19} /><strong>任务安全攻防实验</strong><small>EXPERIMENT 04</small></div><Link className={styles.rangeShortcut} to="/experiments/security/range"><Waypoints size={15} />简易靶场</Link><div className={styles.toolbarStatus}><span className={styles.phaseBadge} data-phase={phase}>{phaseNames[phase]}</span><span className={styles.modeBadge}><Radio size={14} />演示模式 · 设备未连接</span></div></header>
      <div className={styles.body}>
        <aside className={styles.library}><div className={styles.panelLabel}>攻击列表 <span>05 项</span></div>{scenarios.map((item, index) => { const Icon = icons[index]!; return <button key={item.id} className={styles.attackItem} aria-pressed={selected === item.id} onClick={() => { setSelected(item.id); setError(''); setLogsExpanded(false); }}><Icon size={19} /><span><strong>{item.name}</strong><small>{item.task} · {item.group}</small></span><i /></button>; })}<div className={styles.libraryFooter}>各场景独立保存演示阶段；切换不会调度真实无人机。</div></aside>
        <section className={styles.center} aria-label="主要效果展示"><div className={styles.sceneHeader}><div><span className={styles.panelLabel}>{scenario.task} / {scenario.group}</span><h2>{scenario.name}</h2></div><span className={styles.droneList}>三机编组 · {scenario.drones.join(' / ')}</span></div><SecurityScene scenario={scenario} phase={phase} /><div className={styles.sceneMessage} data-phase={phase}><span>{phaseNames[phase]}</span><p>{scenario.notes[phase]}</p></div></section>
        <aside className={styles.inspector} aria-label="实验操作与效果对照"><section className={styles.operations}><div className={styles.panelLabel}>实验操作 <span>01 / ACTION</span></div><p className={styles.attackDescription}>{scenario.description}</p><div className={styles.detailRow}><span>目标无人机</span><strong>{scenario.target}</strong></div><div className={styles.detailRow}><span>对应树莓派节点</span><strong>{scenario.nodes.join(' / ')}</strong></div><div className={styles.detailRow}><span>节点连接</span><strong className={styles.disconnected}>{nodes.some(node => node.connected) ? `${nodes.filter(node => node.connected).length} / 3 在线` : '未连接（演示映射）'}</strong></div><div className={styles.detailRow}><span>当前阶段</span><strong>{phaseNames[phase]}</strong></div><div className={styles.buttons}><button className={styles.attackButton} disabled={busy || phase !== 'baseline'} onClick={() => void act('attack')}><Target size={16} />开始攻击</button><button className={styles.protectButton} disabled={busy || phase !== 'attacked'} onClick={() => void act('protect')}><Shield size={16} />启用防护复测</button><button className={styles.restoreButton} disabled={busy || phase === 'baseline'} onClick={() => void act('restore')}><RotateCcw size={16} />恢复正常基线</button></div>{error && <p role="alert" className={styles.error}>{error}</p>}<small className={styles.modeNote}>操作仅驱动教学示意数据，不向树莓派下发指令。</small></section><section className={styles.comparison}><div className={styles.panelLabel}>效果对照 <span>02 / RESULT</span></div><div className={styles.compareHead}><span>指标</span><span>正常基线</span><span>当前结果</span></div>{scenario.metrics.map(metric => <div className={styles.metricRow} key={metric.label}><span>{metric.label}<small>{metric.unit}</small></span><strong>{metric.values.baseline}</strong><strong data-phase={phase}>{metric.values[phase]}</strong></div>)}<p>指标为演示任务的预计／模拟结果，非实时设备遥测。</p></section></aside>
      </div>
      <footer className={styles.eventFooter}><button className={styles.eventToggle} onClick={() => setLogsExpanded(value => !value)} aria-expanded={logsExpanded}><ClipboardList size={16} />关键事件 <span>{scenarioEvents.length ? `${scenarioEvents[0]!.time} · ${scenarioEvents[0]!.text}` : '当前场景尚无操作，等待开始攻击。'}</span><b>{logsExpanded ? '收起日志' : '展开日志'}</b></button>{logsExpanded && <div className={styles.eventList}>{scenarioEvents.length ? scenarioEvents.map(event => <div key={event.id}><time>{event.time}</time>{event.text}</div>) : <p>暂无事件。开始攻击后会记录阶段变化。</p>}</div>}</footer>
    </div>, document.body)}
  </>;
}
