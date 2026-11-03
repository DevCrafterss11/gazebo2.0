import { useState } from 'react';
import { Activity, Box, Check, CheckCircle2, ChevronRight, CircleHelp, ClipboardCheck, Cpu, FileCode2, Monitor, Network, Radio, RefreshCw, Satellite, Wifi } from 'lucide-react';
import { instanceLabels } from '../../domain/collaborationMission';
import { useCollaborationStore } from '../../stores/collaborationStore';
import shared from './Collaboration.module.css';
import styles from './SystemReadiness.module.css';

/** Step 1 only: configuration verification and an explicitly labelled conceptual link diagram. */
export function SystemReadiness() {
  const s = useCollaborationStore();
  const [selectedNode, setSelectedNode] = useState('uav101');
  const [selectedCheck, setSelectedCheck] = useState('resources');
  const [checkedAgain, setCheckedAgain] = useState(false);
  const drones = s.missionState.drones;
  const nodes = s.communicationNodes;
  const expectedIds = Array.from({ length: 15 }, (_, i) => `uav${101 + i}`);
  const validDrones = expectedIds.filter((id) => drones.filter((d) => d.id === id).length === 1).length;
  const validMappings = expectedIds.filter((id, i) => {
    const ip = `192.168.10.${101 + i}`;
    return drones.filter((d) => d.id === id && d.raspberryPiIp === ip).length === 1
      && drones.filter((d) => d.raspberryPiIp === ip).length === 1
      && nodes.filter((n) => n.droneId === id && n.ip === ip).length === 1
      && nodes.filter((n) => n.ip === ip).length === 1;
  }).length;
  const validResources = validDrones === 15 && validMappings === 15 && drones.length === 15 && nodes.length === 15;
  const canContinue = validResources && s.simulationEnabled;
  const selected = drones.find((d) => d.id === selectedNode);
  const assignedGroup = s.missionState.groups.find((group) => group.id === selected?.taskGroupId);
  const node = nodes.find((n) => n.droneId === selectedNode);
  const time = new Date(s.lastCheckAt).toLocaleTimeString('zh-CN', { hour12: false });
  const checks = [
    { id: 'gazebo', title: 'Gazebo 仿真服务', desc: '仿真引擎与 World 加载能力', Icon: Box, status: '接口待接入', detail: '真实进程与服务健康状态需要后端环境检查接口。当前页面不会启动或探测本机 Gazebo。' },
    { id: 'world', title: 'World 场景文件', desc: '场景资源与模型依赖', Icon: FileCode2, status: '接口待接入', detail: '尚未接入 World 文件检查接口，无法确认真实场景文件是否存在。Mock 场景使用前端模拟坐标。' },
    { id: 'resources', title: '15 架无人机配置', desc: '固定编号与树莓派一一映射', Icon: Satellite, status: validResources ? '配置完整' : '配置异常', detail: `已校验 ${validDrones}/15 个独立无人机编号、${validMappings}/15 条唯一 IP 映射。配置校验不代表飞控已连接；集群启动后仍无默认任务。` },
    { id: 'sitl', title: 'SITL 运行依赖', desc: '飞控实例与运行环境', Icon: Cpu, status: '接口待接入', detail: '真实 ArduPilot SITL 依赖检查和实例管理尚未接入。教学模式由统一 Mock Runtime 模拟实例生命周期。' },
    { id: 'host', title: '主机运行资源', desc: 'CPU、内存与进程资源', Icon: Activity, status: '接口待接入', detail: 'CPU 占用、内存余量与真实并发承载能力均需后端采集。当前不展示未经采集的主机性能数据。' },
    { id: 'network', title: '树莓派网络', desc: '15 个独立通信节点', Icon: Wifi, status: '接口待接入', detail: '真实网络可达性需要后端网关检测。下方拓扑表示资源对应关系，不代表网络在线；浏览器不执行 SSH 或网络探测。' },
    { id: 'mavlink', title: 'MAVLink 转发', desc: '转发服务与飞控心跳', Icon: Radio, status: '接口待接入', detail: '实验三真实转发服务与心跳接收尚未接入。教学模拟启动后显示的心跳、遥测均带 Mock 数据来源标识。' },
  ];
  const detail = checks.find((c) => c.id === selectedCheck) ?? checks[2]!;
  const nextHint = !validResources ? '资源配置不完整，请检查编号与 IP 映射。'
    : !s.simulationEnabled ? '请先点击「进入教学模拟模式」。'
    : s.clusterStarting ? '集群正在启动，可返回步骤2查看进度。'
    : s.clusterRunning ? '集群正在运行，可返回步骤2查看启动状态。'
    : '资源配置已就绪，下一步手动启动 15 架模拟无人机。';
  const checkAgain = () => { s.recheck(); setCheckedAgain(true); };
  return <div className={styles.readiness}>
    <div className={styles.toolbar}>
      <div className={styles.summary} aria-label="系统感知概览">{s.notice && <span role="status" className={styles.sessionNotice}>{s.notice}</span>}<span><Satellite size={16} />无人机 <b>{validDrones}/15</b></span><span><Network size={16} />节点映射 <b>{validMappings}/15</b></span><span className={styles.modeState}>{s.simulationEnabled ? <CheckCircle2 size={15} aria-hidden="true" /> : <CircleHelp size={15} aria-hidden="true" />}{s.simulationEnabled ? '教学模拟已选择' : '请选择运行方式'}</span></div>
      <button className={shared.primary} type="button" disabled={!validResources || s.simulationEnabled} onClick={s.enterSimulation}>{s.simulationEnabled ? <><Check size={16} />已进入教学模拟模式</> : '进入教学模拟模式'}</button>
    </div>
    <div className={styles.mainGrid}>
      <section className={styles.panel} aria-labelledby="readiness-check-title">
        <header className={styles.panelHeader}><div><h3 id="readiness-check-title"><ClipboardCheck size={17} />运行环境检查</h3><p>本地配置可校验 · 真实检测接口待接入</p></div><button className={shared.secondary} type="button" onClick={checkAgain}><RefreshCw size={15} />重新检查</button></header>
        <div className={styles.checkTable}>
          <div className={styles.tableHead}><span>检查项目</span><span>检查结果</span><span>真实启动</span><span>详情</span></div>
          {checks.map(({ id, title, desc, Icon, status }) => <div className={`${styles.checkRow} ${selectedCheck === id ? styles.selectedRow : ''}`} key={id}>
            <div className={styles.checkName}><Icon size={17} /><div><b>{title}</b><small>{desc}</small></div></div>
            <span className={status === '配置完整' ? styles.success : status === '配置异常' ? styles.error : styles.pending}>{status === '配置完整' && <Check size={12} />}{status}</span>
            <span className={styles.blocking}>{status === '配置完整' ? '已满足' : id === 'resources' ? '阻塞' : '待验证'}</span>
            <button className={styles.detailButton} aria-label={`查看${title}说明`} aria-pressed={selectedCheck === id} type="button" onClick={() => setSelectedCheck(id)}><ChevronRight size={16} /></button>
          </div>)}
        </div>
        <div className={styles.checkDetail} aria-live="polite"><CircleHelp size={16} /><div><b>{detail.title}</b><p>{detail.detail}</p></div></div>
        <footer className={styles.panelFoot}><span>最后检查 <time>{time}</time></span><span role="status">{checkedAgain ? '本地配置已重新校验 · 真实检测仍待接入' : '6 项真实检测待接入 · 阻塞真实启动'}</span></footer>
      </section>
      <section className={styles.panel} aria-labelledby="readiness-topology-title">
        <header className={styles.panelHeader}><div><h3 id="readiness-topology-title"><Network size={17} />集群资源与数据链路</h3><p>一架无人机对应一个树莓派节点 · 点击查看映射</p></div><span className={styles.outlineTag}>结构示意</span></header>
        <div className={styles.topology}>
          <div className={styles.linkStrip}><Monitor size={17} /><b>教学平台</b><ChevronRight size={14} /><Radio size={17} /><b>MAVLink Gateway</b><ChevronRight size={14} /><span>15 个通信节点</span></div>
          <div className={styles.nodeGrid} aria-label="15 台树莓派与无人机映射">{expectedIds.map((id) => {
            const d = drones.find((item) => item.id === id);
            return <button key={id} type="button" aria-label={`查看${id}资源映射`} aria-pressed={selectedNode === id} onClick={() => setSelectedNode(id)} className={selectedNode === id ? styles.nodeActive : ''}><Cpu size={17} /><b>{id}</b><span>{d?.raspberryPiIp?.split('.').slice(-1).map((suffix) => `IP .${suffix}`) ?? '未配置'}</span></button>;
          })}</div>
          <div className={styles.mappingDetail} aria-live="polite"><Satellite size={18} /><div><b>{selectedNode}</b><span>{selected ? `${selected.droneType} · ${selected.payload}` : '资源未配置'} · 树莓派 {node?.ip ?? '节点未配置'}</span></div><span className={styles.pending}>{node?.network ?? '未配置'}</span></div>
          <dl className={styles.resourceFacts} aria-label="所选无人机资源详情">
            <div><dt>实例状态</dt><dd>{selected ? instanceLabels[selected.instanceStatus] : '未配置'}</dd></div>
            <div><dt>任务占用</dt><dd>{selected?.assignedTaskId ? assignedGroup?.name ?? selected.assignedTaskId : '未分配任务'}</dd></div>
            <div><dt>Home X / Y (m)</dt><dd>{selected ? `${selected.homePosition.x.toFixed(1)} / ${selected.homePosition.y.toFixed(1)}` : '未配置'}</dd></div>
            <div><dt>阵列 / 行列间距 (m)</dt><dd>3 × 5 · {s.arrayLayout.rowSpacing} / {s.arrayLayout.columnSpacing}</dd></div>
          </dl>
          <p className={styles.topologyNote}>节点卡片表示配置映射，不代表真实连接。数据来源：{node?.source ?? '未配置'}。</p>
        </div>
      </section>
    </div>
    <footer className={styles.nextBar} aria-label="系统感知步骤操作">
      <div className={styles.nextStatus} aria-live="polite"><ClipboardCheck size={19} /><div><b>{!canContinue ? '启动前准备' : s.clusterStarting ? '集群启动中' : s.clusterRunning ? '集群正在运行' : '教学模拟准备就绪'}</b><p id="readiness-next-note">{nextHint}<span>仅切换步骤，不启动集群或任务</span></p></div></div>
      <button className={shared.primary} type="button" disabled={!canContinue} aria-describedby="readiness-next-note" onClick={() => s.setStep(1)}>下一步：集群启动<ChevronRight size={17} /></button>
    </footer>
  </div>;
}
