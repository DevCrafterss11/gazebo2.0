import { useCollaborationStore } from '../../../stores/collaborationStore';
import gpsStyles from './GpsAttackControls.module.css';
import { useRef, useState } from 'react';
import { Shield, Zap, Radio, Battery, Activity, AlertTriangle, X, LibraryBig } from 'lucide-react';
import { attackSteps, useAttackScriptStore } from '../../../stores/attackScriptStore';
import type { AttackType } from '../../../types/security';
import { AttackConfigDialog } from './AttackConfigDialog';
import { useBasicAttackConfigStore } from '../../../stores/basicAttackConfigStore';
import { attackLabels, resolveDroneAttackConfig } from '../../../domain/basicAttackConfig';
import { AttackScriptLibrary } from './AttackScriptLibrary';
import styles from '../TaskCommand.module.css';

interface AttackControlPanelProps {
  onClose: () => void;
}

export function AttackControlPanel({ onClose }: AttackControlPanelProps) {
  const [selectedAttack, setSelectedAttack] = useState<AttackType | null>('GPS_SPOOFING');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [configuringAttack, setConfiguringAttack] = useState<AttackType | null>(null);
  const [saveMessage, setSaveMessage] = useState('');
  const configTrigger = useRef<HTMLButtonElement | null>(null);
  const configs = useBasicAttackConfigStore(state => state.configs);
  const mission = useCollaborationStore(state => state.missionState);
  const startGpsAttack = useCollaborationStore(state => state.startGpsAttack);
  const stopGpsAttack = useCollaborationStore(state => state.stopGpsAttack);
  const activeTargets = mission.drones.filter(d => d.gpsAttack);
  const [executionError, setExecutionError] = useState('');
  const selectedConfig = selectedAttack ? configs[selectedAttack] : undefined;
  const closeConfig = () => { setConfiguringAttack(null); requestAnimationFrame(() => configTrigger.current?.focus()); };
  const libraryButton = useRef<HTMLButtonElement>(null);
  const selectedScriptId = useAttackScriptStore(state => state.selectedId);
  const selectScript = useAttackScriptStore(state => state.select);
  const selectedScript = useAttackScriptStore(state => state.scripts().find(script => script.id === selectedScriptId));

  const canStartGps = selectedConfig?.attackType === 'GPS_SPOOFING' && !selectedScript;

  const attacks: Array<{ type: AttackType; icon: typeof Zap; label: string; desc: string }> = [
    { type: 'GPS_SPOOFING', icon: Activity, label: 'GPS欺骗', desc: '伪造定位信号，导致无人机位置偏移' },
    { type: 'COMMAND_INJECTION', icon: Zap, label: '命令注入', desc: '注入异常飞行指令，干扰任务执行' },
    { type: 'COMM_HIJACK', icon: Radio, label: '通信劫持', desc: '拦截或篡改通信链路，导致失联' },
    { type: 'BATTERY_DRAIN', icon: Battery, label: '电量攻击', desc: '模拟电量异常消耗，迫使提前返航' },
    { type: 'SENSOR_NOISE', icon: AlertTriangle, label: '传感器干扰', desc: '姿态数据异常，影响飞行稳定性' },
  ];

  const closeLibrary = () => { setLibraryOpen(false); requestAnimationFrame(() => libraryButton.current?.focus()); };

  return (
    <aside className={styles.layer} role="region" aria-label="安全攻防控制面板" style={{ width: '340px' }}>
      <header>
        <div>
          <Shield size={17} style={{ color: '#ff6b6b' }} />
          <b>攻击控制面板</b>
        </div>
        <button type="button" aria-label="关闭攻击面板" onClick={onClose}>
          <X size={18} />
        </button>
      </header>

      <div className={styles.layerContext} style={{ background: 'rgba(255,107,107,0.1)', borderLeft: '3px solid #ff6b6b' }}>
        <AlertTriangle size={14} style={{ color: '#ff6b6b' }} />
        <span>实验性功能 · 仅用于安全攻防演练教学</span>
      </div>

      <div className={styles.layerBody}>
        <button ref={libraryButton} type="button" onClick={() => setLibraryOpen(true)} style={{ width: '100%', justifyContent: 'space-between', marginBottom: 10, borderColor: '#61c4b0' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><LibraryBig size={16} />攻击库</span><span>选择 / 上传 / 创建</span>
        </button>
        {selectedScript && <div role="status" style={{ padding: '8px 10px', marginBottom: 14, background: '#16434a', color: '#bdf1e5', fontSize: 12, lineHeight: 1.6 }}>
          <b>已选择配置：{selectedScript.name} · 仅预览</b>
          {attackSteps(selectedScript).map((step, index) => <div key={step.id}>{index + 1}. {attacks.find(item => item.type === step.attackType)?.label} → {step.targetDroneIds.length ? step.targetDroneIds.join('、') : '尚未指定目标，请在攻击库中配置'} · {{ low: '轻微', medium: '中等', high: '严重' }[step.severity]}</div>)}
        </div>}
        <p style={{ fontSize: 12 }}>点击基础攻击，在弹窗中统一设置目标无人机、强度和场景参数。</p>
        {/* 攻击类型选择 */}
        <section style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '14px', marginBottom: '12px', color: '#e8f8ff' }}>
            基础攻击类型（单项演示）
          </h3>
          <div style={{ display: 'grid', gap: '8px' }}>
            {attacks.map(attack => {
              const Icon = attack.icon;
              const isSelected = selectedAttack === attack.type;
              return (
                <button
                  key={attack.type}
                  type="button"
                  aria-haspopup="dialog"
                  onClick={event => { configTrigger.current = event.currentTarget; setConfiguringAttack(attack.type); setSaveMessage(''); }}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px',
                    padding: '12px',
                    border: `1px solid ${isSelected ? '#ff6b6b' : '#255a78'}`,
                    borderRadius: '6px',
                    background: isSelected ? 'rgba(255,107,107,0.15)' : '#09334f',
                    color: isSelected ? '#fff' : '#b5d4e5',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  <Icon size={18} style={{ color: isSelected ? '#ff6b6b' : '#5edbff', flexShrink: 0, marginTop: '2px' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>
                      {attack.label}<span style={{ float: 'right', fontSize: 10, color: '#79e3d0' }}>{configs[attack.type] ? '已配置 · 编辑' : '配置参数'}</span>
                    </div>
                    <div style={{ fontSize: '11px', color: isSelected ? '#ffd4d4' : '#89b5c9', lineHeight: 1.5 }}>
                      {attack.desc}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {saveMessage && <p role="status" style={{ color: '#79e3d0', fontSize: 12 }}>{saveMessage}</p>}
        {selectedConfig && !selectedScript && <section style={{ marginBottom: 20, padding: 12, background: '#16434a', borderRadius: 6, fontSize: 12, lineHeight: 1.8 }} aria-label="基础攻击配置摘要">
          <b>{selectedConfig.name}</b>
          <div>{attackLabels[selectedConfig.attackType]} · {selectedConfig.attackType === 'GPS_SPOOFING' ? '逐机独立配置' : { low: '轻微', medium: '中等', high: '严重' }[selectedConfig.severity]}</div>
          <div>目标：{selectedConfig.targetDroneIds.join('、') || '未指定（参数预设）'}</div>
          {selectedConfig.attackType === 'GPS_SPOOFING' && selectedConfig.targetDroneIds.length ? <div style={{ maxHeight: 160, overflowY: 'auto' }}>{selectedConfig.targetDroneIds.map(id => {
            const local = resolveDroneAttackConfig(selectedConfig, id), v = local.values;
            return <div key={id}>{id} · {{ low: '轻微', medium: '中等', high: '严重' }[local.severity]} · {v.mode === 'path' ? '路径回放' : `东 ${v.offsetX} / 北 ${v.offsetY} / 高 ${v.offsetZ} m`} · 延迟 {String(v.delay)} s / 持续 {String(v.duration)} s</div>;
          })}</div> : <div>持续 {String(selectedConfig.values.duration)} s · 启动延迟 {String(selectedConfig.values.delay)} s</div>}
          <small>{selectedConfig.attackType === 'GPS_SPOOFING' ? '已保存到本机 · 点击下方启动后生效' : '已保存到本机 · 此攻击尚未接入仿真'}</small>
        </section>}
        {/* 当前激活的攻击 */}
        <section>
          <h3 style={{ fontSize: '14px', marginBottom: '12px', color: '#e8f8ff' }}>
            活跃攻击（{activeTargets.length} 架）
          </h3>
          <div style={{
            padding: '16px',
            border: '1px solid #255a78',
            borderRadius: '6px',
            background: '#09334f',
            color: '#89b5c9',
            fontSize: '12px',
            textAlign: 'center'
          }}>
            {!activeTargets.length ? '暂无活跃攻击' : <div className={gpsStyles.targets}>
              <button type="button" onClick={() => stopGpsAttack()}>停止全部 GPS 攻击</button>
              {activeTargets.map(d => <div key={d.id} className={gpsStyles.target}>
                <b>{d.id} · {mission.groups.find(g => g.id === d.gpsAttack!.groupId)?.name}</b>
                <span>{d.gpsAttack!.config.name} · {{ delayed: '等待启动', active: '生效中', paused: '断连暂停' }[d.gpsAttack!.phase]}</span>
                <span>剩余 {Math.max(0, Math.ceil(Number(d.gpsAttack!.config.values.delay) + Number(d.gpsAttack!.config.values.duration) - d.gpsAttack!.elapsed))} s · 偏移 {Math.hypot(d.gpsAttack!.offset.x, d.gpsAttack!.offset.y).toFixed(1)} m</span>
                <button type="button" onClick={() => stopGpsAttack([d.id])} aria-label={`停止GPS攻击 ${d.id}`}>停止该机攻击</button>
              </div>)}

            </div>}
          </div>
        </section>
      </div>

      {executionError && <p role="alert" className={gpsStyles.error}>{executionError}</p>}
      <p className={gpsStyles.legend}>红线：受攻击期间实际轨迹；橙色空心点：被欺骗的 GPS 定位。可跨任务多选，重复攻击同一架前需先停止。</p>
      <footer>
        <button
          type="button"
          disabled={!canStartGps}
          onClick={() => {
            if (selectedConfig) {
              const ok = startGpsAttack(selectedConfig);
              setExecutionError(ok ? '' : useCollaborationStore.getState().notice);
              if (ok) setSaveMessage('GPS 欺骗已启动；可继续配置其他任务目标');
            }
          }}
          title="对所选任务无人机启动 GPS 欺骗模拟"
          style={{
            flex: 1,
            padding: '10px 16px',
            border: '1px solid #ff6b6b',
            borderRadius: '5px',
            background: canStartGps ? '#a83d45' : '#2a4a5f',
            color: canStartGps ? '#fff' : '#9bb5bd',
            fontSize: '13px',
            fontWeight: 600,
            cursor: selectedConfig?.attackType === 'GPS_SPOOFING' && !selectedScript ? 'pointer' : 'not-allowed',
            transition: 'all 0.2s',
          }}
        >
          <Zap size={15} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
          {selectedConfig?.attackType === 'GPS_SPOOFING' && !selectedScript ? '启动 GPS 欺骗' : '攻击执行待接入'}
        </button>
        <button type="button" onClick={onClose}>
          关闭面板
        </button>
      </footer>
      {configuringAttack && <AttackConfigDialog key={configuringAttack} attackType={configuringAttack} onClose={closeConfig} onSaved={config => {
        setSelectedAttack(config.attackType); setExecutionError(''); selectScript(null); setSaveMessage(`${config.name}已保存`); closeConfig();
      }} />}
      {libraryOpen && <AttackScriptLibrary onClose={closeLibrary} onUse={script => { setSelectedAttack(script.isBuiltIn ? script.attackType : null); closeLibrary(); }} />}
    </aside>
  );
}
