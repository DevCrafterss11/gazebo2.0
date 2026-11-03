import { useEffect, useRef, useState } from 'react';
import { Check, RotateCcw, Settings2, X } from 'lucide-react';
import type { AttackSeverity, AttackType } from '../../../types/security';
import { attackLabels, configFields, defaultAttackConfig, fieldVisible, parseWaypoints, resolveDroneAttackConfig, validateAttackConfig, type BasicAttackConfig, type ConfigValue, type PositionPoint } from '../../../domain/basicAttackConfig';
import { useBasicAttackConfigStore } from '../../../stores/basicAttackConfigStore';
import { useCollaborationStore } from '../../../stores/collaborationStore';
import { AttackTaskTargetPicker } from './AttackTaskTargetPicker';
import shell from './AttackScriptLibrary.module.css';
import styles from './AttackConfigDialog.module.css';

function PositionPreview({ config }: { config: BasicAttackConfig }) {
  const v = config.values;
  const points: PositionPoint[] | null = v.mode === 'path' ? parseWaypoints(String(v.waypoints)) : [[0, 0, 0], [Number(v.offsetX), Number(v.offsetY), Number(v.offsetZ)]];
  if (!points || points.some(p => !p.every(Number.isFinite))) return <p>填写有效位置参数后显示预览。</p>;
  const scale = Math.max(20, ...points.flatMap(p => [Math.abs(p[0]), Math.abs(p[1])])) * 1.2;
  const xy = points.map(p => [140 + p[0] / scale * 110, 85 - p[1] / scale * 65]);
  return <div className={styles.preview}>
    <svg viewBox="0 0 280 170" role="img" aria-label="GPS 水平偏移示意图">
      <path d="M20 85H260M140 12V158" stroke="#396775" strokeDasharray="4 4" />
      <polyline points={xy.map(p => p.join(',')).join(' ')} fill="none" stroke="#79e3d0" strokeWidth="2" />
      {xy.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="3" fill="#ffc664" />)}
      <text x="247" y="78" fill="#b4d0d4" fontSize="11">东</text><text x="147" y="20" fill="#b4d0d4" fontSize="11">北</text>
    </svg>
    <small>水平偏移示意 · 自动缩放 · 非实时飞行轨迹</small>
  </div>;
}

export function AttackConfigDialog({ attackType, onClose, onSaved }: {
  attackType: AttackType;
  onClose: () => void; onSaved: (config: BasicAttackConfig) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const mission = useCollaborationStore(state => state.missionState);
  const selectedGroup = useCollaborationStore(state => state.selectedTaskGroup);
  const saveConfig = useBasicAttackConfigStore(state => state.save);
  const [draft, setDraft] = useState<BasicAttackConfig>(() => {
    const saved = useBasicAttackConfigStore.getState().configs[attackType];
    return saved ? structuredClone(saved) : defaultAttackConfig(attackType);
  });
  const [editingDrone, setEditingDrone] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const isGps = attackType === 'GPS_SPOOFING';
  const currentDrone = isGps ? (draft.targetDroneIds.includes(editingDrone) ? editingDrone : draft.targetDroneIds[0] ?? '') : '';
  const editingConfig = currentDrone ? resolveDroneAttackConfig(draft, currentDrone) : draft;
  const [attempted, setAttempted] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [activeGroup, setActiveGroup] = useState('基础设置');
  const fields = configFields(attackType);
  const groups = ['基础设置', ...new Set(fields.map(field => field.group)), '配置预览'];
  const members = new Set(mission.groups.flatMap(group => group.drones));
  const availableTargets = mission.drones.filter(drone => members.has(drone.id)).map(drone => drone.id);
  const invalidTargets = draft.targetDroneIds.filter(id => !availableTargets.includes(id));
  const allErrors = attempted ? validateAttackConfig(draft, availableTargets) : {};
  const errors = attempted ? validateAttackConfig(editingConfig, availableTargets) : {};
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  const changeParameters = (patch: { severity?: AttackSeverity; values?: Record<string, ConfigValue> }) => {
    setSaveError(''); setCopyMessage('');
    setDraft(current => {
      if (!currentDrone) return { ...current, ...patch };
      const config = resolveDroneAttackConfig(current, currentDrone);
      return { ...current, droneConfigs: { ...current.droneConfigs,
        [currentDrone]: { severity: patch.severity ?? config.severity, values: patch.values ?? config.values } } };
    });
  };
  const changeValue = (key: string, value: ConfigValue) => changeParameters({ values: { ...editingConfig.values, [key]: value } });
  const toggleTarget = (id: string) => {
    setCopyMessage('');
    setDraft(current => {
      const selected = current.targetDroneIds.includes(id);
      const config = resolveDroneAttackConfig(current, id);
      return { ...current, targetDroneIds: selected ? current.targetDroneIds.filter(item => item !== id) : [...current.targetDroneIds, id],
        ...(isGps && !selected ? { droneConfigs: { ...current.droneConfigs, [id]: { severity: config.severity, values: config.values } } } : {}) };
    });
  };
  const copyToAll = () => {
    setDraft(current => ({ ...current, droneConfigs: { ...current.droneConfigs,
      ...Object.fromEntries(current.targetDroneIds.map(id => [id, { severity: editingConfig.severity, values: { ...editingConfig.values } }])) } }));
    setCopyMessage(`已将 ${currentDrone} 的全部参数复制到 ${draft.targetDroneIds.length} 架已选无人机`);
  };
  const jump = (group: string) => {
    setActiveGroup(group);
    document.getElementById(`attack-config-${groups.indexOf(group)}`)?.scrollIntoView({ block: 'start' });
  };
  const submit = () => {
    setAttempted(true); setSaveError('');
    const validation = validateAttackConfig(draft, availableTargets);
    if (Object.keys(validation).length) {
      const invalidDrone = draft.targetDroneIds.find(id => Object.keys(validation).some(key => key.startsWith(`drone:${id}:`)));
      if (invalidDrone) setEditingDrone(invalidDrone);
      requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    try { saveConfig(draft, availableTargets); onSaved(draft); }
    catch (error) { setSaveError(error instanceof Error ? error.message : '保存失败，请重试'); }
  };
  const errorText = (key: string) => errors[key] ? <small id={`error-${key}`} className={styles.error}>{errors[key]}</small> : null;
  return <dialog ref={dialog} className={`${shell.dialog} ${styles.dialog}`} aria-label={`${attackLabels[attackType]}配置`} onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}>
    <header className={shell.header}>
      <div className={shell.heading}><Settings2 size={21} /><div><h2>{attackLabels[attackType]}配置</h2><span>实验三 · 基础攻击参数</span></div></div>
      <button type="button" className={shell.iconButton} aria-label="关闭攻击配置" onClick={onClose}><X size={19} /></button>
    </header>
    <div className={shell.notice}>{attackType === 'GPS_SPOOFING' ? 'GPS 欺骗已接入任务模拟。保存后在攻击面板启动，支持跨任务多选；保存本身不会执行攻击。' : '所有参数仅保存在本机，尚未参与仿真。保存配置不会执行攻击。'}</div>
    <form ref={form} noValidate className={styles.form} onSubmit={event => { event.preventDefault(); submit(); }}>
      <div className={styles.workspace}>
        <nav className={styles.nav} aria-label="攻击配置分组">
          <div className={styles.navTitle}>参数配置<small>{fields.length} 项场景参数</small></div>
          {groups.map((group, index) => <button type="button" key={group} aria-current={activeGroup === group ? 'location' : undefined} onClick={() => jump(group)}><span>{String(index + 1).padStart(2, '0')}</span>{group}</button>)}
          <p>独立保存 · 本地预设<br />支持随时修改与恢复默认值</p>
        </nav>
        <div className={styles.editor}>
          {isGps && <div className={styles.droneToolbar}>
            <div className={styles.editorHeading}><strong>{currentDrone ? `正在配置 ${currentDrone}` : '默认参数预设'}</strong><span>{currentDrone ? '仅修改当前无人机' : '新选无人机将使用这些初始参数'}</span></div>
            <div className={styles.editorControls}>
              <label>编辑无人机<select aria-label="编辑无人机" value={currentDrone} disabled={!currentDrone} onChange={e => { setEditingDrone(e.target.value); setCopyMessage(''); }}>
                {!currentDrone && <option value="">尚未选择目标</option>}
                {draft.targetDroneIds.map(id => <option key={id} value={id}>{id} · {mission.groups.find(group => group.drones.includes(id))?.name ?? '失效目标'}{Object.keys(allErrors).some(key => key.startsWith(`drone:${id}:`)) ? ' · 待修正' : ''}</option>)}
              </select></label>
              <label>本机强度<select aria-label="场景强度" value={editingConfig.severity} onChange={e => changeParameters({ severity: e.target.value as AttackSeverity })}><option value="low">轻微</option><option value="medium">中等</option><option value="high">严重</option></select></label>
              <button type="button" disabled={draft.targetDroneIds.length < 2} onClick={copyToAll}>复制当前参数到全部已选</button>
            </div>
            {copyMessage && <small role="status">{copyMessage}</small>}
          </div>}
        <div className={styles.content}>
          <section id="attack-config-0" className={styles.section}>
            <h3>基础设置<span>配置身份与作用目标</span></h3>
            <div className={styles.grid}>
              <label className={styles.field}>配置名称<input autoFocus maxLength={40} value={draft.name} aria-invalid={!!errors.name} aria-describedby={errors.name ? 'error-name' : undefined} onChange={e => setDraft({ ...draft, name: e.target.value })} />{errorText('name')}</label>
              {!isGps && <label className={styles.field}>场景强度<select aria-label="场景强度" value={draft.severity} onChange={e => setDraft({ ...draft, severity: e.target.value as AttackSeverity })}><option value="low">轻微</option><option value="medium">中等</option><option value="high">严重</option></select></label>}
              <label className={`${styles.field} ${styles.wide}`}>场景说明<textarea maxLength={200} rows={2} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} placeholder="记录本次教学场景的目的与观察重点" /></label>
            </div>
            <AttackTaskTargetPicker mission={mission} initialGroupId={selectedGroup} selectedIds={draft.targetDroneIds} onToggle={toggleTarget} />
            <p className={styles.hint}>{isGps ? '勾选目标后，在上方切换无人机逐一配置。取消勾选会保留本次编辑，保存时仅保存已选目标。' : '可先保存无目标的参数预设，使用前再选择任务内无人机。'}</p>
            {!!invalidTargets.length && <div className={styles.error} role="alert">目标已失效：{invalidTargets.join('、')}<button type="button" onClick={() => setDraft({ ...draft, targetDroneIds: draft.targetDroneIds.filter(id => availableTargets.includes(id)) })}>移除失效目标</button></div>}
          </section>
          {groups.slice(1, -1).map(group => <section key={group} id={`attack-config-${groups.indexOf(group)}`} className={styles.section}>
            <h3>{group}<span>{attackType === 'GPS_SPOOFING' ? currentDrone ? `仅 ${currentDrone}` : '新选目标的默认参数' : '仅保存，尚未参与仿真'}</span></h3>
            <div className={styles.grid}>{fields.filter(field => field.group === group && fieldVisible(field, editingConfig.values)).map(field => {
              const id = `config-${field.key}`;
              const props = { id, 'aria-invalid': !!errors[field.key], 'aria-describedby': `${id}-help${errors[field.key] ? ` error-${field.key}` : ''}` };
              return <div key={field.key} className={`${styles.field} ${field.multiline ? styles.wide : ''}`}>
                <label htmlFor={id}>{field.label}{field.unit ? ` (${field.unit})` : ''}</label>
                {field.type === 'select' ? <select {...props} value={String(editingConfig.values[field.key])} onChange={e => changeValue(field.key, e.target.value)}>{field.options?.map(option => <option key={String(option.value)} value={option.value}>{option.label}</option>)}</select>
                  : field.type === 'boolean' ? <label className={styles.switch}><input {...props} type="checkbox" checked={editingConfig.values[field.key] === true} onChange={e => changeValue(field.key, e.target.checked)} /><span>{editingConfig.values[field.key] ? '已开启' : '已关闭'}</span></label>
                  : field.multiline ? <textarea {...props} rows={4} maxLength={6000} value={String(editingConfig.values[field.key])} onChange={e => changeValue(field.key, e.target.value)} />
                  : <input {...props} type={field.type === 'number' ? 'number' : 'text'} step="any" min={field.min} max={field.max} value={typeof editingConfig.values[field.key] === 'number' && !Number.isFinite(editingConfig.values[field.key]) ? '' : String(editingConfig.values[field.key])} onChange={e => changeValue(field.key, field.type === 'number' ? e.target.value === '' ? NaN : Number(e.target.value) : e.target.value)} />}
                <small id={`${id}-help`} className={styles.hint}>{field.description ?? (field.type === 'number' ? `范围 ${field.min}–${field.max}${field.unit ? ` ${field.unit}` : ''}` : '')}</small>{errorText(field.key)}
              </div>;
            })}</div>
          </section>)}
          <section id={`attack-config-${groups.length - 1}`} className={styles.section}>
            <h3>配置预览<span>保存前核对</span></h3>
            {attackType === 'GPS_SPOOFING' && <p className={styles.hint}>强度按轻微 35%、中等 65%、严重 100% 缩放偏移与噪声。路径在持续时间内遍历一次；循环模式每段 10 秒。更新间隔最低按遥测周期 200 ms 执行。参考经纬度和高度仅作预设备注，不改变地图原点；日志级别与记录开关暂作预留，任务轨迹始终保留。攻击计时独立于任务暂停；地面队列仍按原任务依赖起飞。返航、任务结束或触及启用的停止边界时终止攻击。</p>}
            {isGps && <>
              <p className={styles.hint}>偏移表示 GPS 上报位置相对实际位置的差值，飞控修正可能使实际轨迹向相反方向偏离；并非指定实际飞行终点。东 / 北为正，西 / 南为负。</p>
              <div className={styles.comparison}><table aria-label="逐机参数总览"><thead><tr><th>无人机</th><th>模式 / 强度</th><th>东 / 北 / 高 (m)</th><th>延迟 / 持续 (s)</th></tr></thead><tbody>{draft.targetDroneIds.map(id => {
                const local = resolveDroneAttackConfig(draft, id), v = local.values;
                return <tr key={id}><td><button type="button" onClick={() => { setEditingDrone(id); jump('位置与轨迹'); }}>{id}</button></td><td>{{ static: '静态', gradual: '渐变', path: '路径' }[String(v.mode)]} / {{ low: '轻微', medium: '中等', high: '严重' }[local.severity]}</td><td>{v.mode === 'path' ? '独立路径' : `${v.offsetX} / ${v.offsetY} / ${v.offsetZ}`}</td><td>{String(v.delay)} / {String(v.duration)}</td></tr>;
              })}</tbody></table></div>
            </>}
            <p className={styles.hint}>{currentDrone ? `${currentDrone} · ` : ''}{draft.name || '未命名配置'} · {draft.targetDroneIds.length} 架目标 · 持续 {String(editingConfig.values.duration)} s</p>
            {attackType === 'GPS_SPOOFING' && <PositionPreview config={editingConfig} />}
            <dl className={styles.summary}>{fields.filter(field => fieldVisible(field, editingConfig.values)).map(field => <div key={field.key}><dt>{field.label}</dt><dd>{field.options?.find(o => o.value === editingConfig.values[field.key])?.label ?? (typeof editingConfig.values[field.key] === 'boolean' ? editingConfig.values[field.key] ? '开启' : '关闭' : String(editingConfig.values[field.key]))} {field.unit}</dd></div>)}</dl>
          </section>
        </div>
        </div>
      </div>
      <footer className={styles.footer}>
        {(saveError || Object.keys(allErrors).length > 0) && <p role="alert" className={styles.error}>{saveError || `有 ${Object.keys(allErrors).length} 项配置需要修正，请检查标红字段。`}</p>}
        <div className={styles.footerRow}>
          <button type="button" onClick={() => { setDraft(defaultAttackConfig(attackType)); setEditingDrone(''); setCopyMessage(''); setAttempted(false); setSaveError(''); }}><RotateCcw size={14} />恢复默认值</button>
          <div><button type="button" onClick={onClose}>取消</button><button type="submit" className={shell.primary}><Check size={15} />保存配置</button></div>
        </div>
      </footer>
    </form>
  </dialog>;
}
