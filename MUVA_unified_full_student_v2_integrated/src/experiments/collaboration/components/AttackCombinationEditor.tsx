import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useCollaborationStore } from '../../../stores/collaborationStore';
import { attackSteps } from '../../../stores/attackScriptStore';
import type { AttackScript, AttackScriptStep, AttackSeverity, AttackType } from '../../../types/security';
import styles from './AttackScriptLibrary.module.css';

const typeLabels: Record<AttackType, string> = {
  GPS_SPOOFING: 'GPS 欺骗', COMMAND_INJECTION: '命令注入', COMM_HIJACK: '通信劫持',
  BATTERY_DRAIN: '电量攻击', SENSOR_NOISE: '传感器干扰',
};
const severityLabels: Record<AttackSeverity, string> = { low: '轻微', medium: '中等', high: '严重' };

export function AttackCombinationEditor({ base, templates, onSave, onCancel }: {
  base: AttackScript | null;
  templates: AttackScript[];
  onSave: (draft: { name: string; description: string; steps: AttackScriptStep[] }) => void;
  onCancel: () => void;
}) {
  const drones = useCollaborationStore(s => s.missionState.drones);
  const [name, setName] = useState(base ? `${base.name} - 自定义` : '');
  const [description, setDescription] = useState(base?.description ?? '');
  const [steps, setSteps] = useState<AttackScriptStep[]>(() => base ? attackSteps(base).map(step => ({
    ...step, id: crypto.randomUUID(), parameters: step.parameters.map(parameter => ({ ...parameter })), targetDroneIds: [...step.targetDroneIds],
  })) : []);
  const [error, setError] = useState('');
  const update = (id: string, patch: Partial<AttackScriptStep>) => setSteps(current => current.map(step => step.id === id ? { ...step, ...patch } : step));
  const move = (index: number, offset: number) => setSteps(current => {
    const copy = [...current];
    [copy[index], copy[index + offset]] = [copy[index + offset]!, copy[index]!];
    return copy;
  });
  const add = (type: AttackType) => {
    const template = templates.find(script => script.attackType === type);
    if (!template || steps.length >= 20) return;
    setSteps(current => [...current, { id: crypto.randomUUID(), attackType: type, severity: template.severity,
      parameters: template.parameters.map(parameter => ({ ...parameter })), targetDroneIds: [] }]);
    setError('');
  };
  const save = () => {
    if (!name.trim()) { setError('请输入脚本名称'); return; }
    if (!steps.length) { setError('请添加至少一种基础攻击'); return; }
    if (steps.some(step => !step.targetDroneIds.length)) { setError('请为每个攻击步骤指定至少一架无人机'); return; }
    if (steps.some(step => step.targetDroneIds.some(id => !drones.some(drone => drone.id === id)))) { setError('包含当前机队中不存在的无人机，请重新选择目标'); return; }
    if (steps.some(step => step.parameters.some(p => p.type === 'number' &&
      (typeof p.defaultValue !== 'number' || !Number.isFinite(p.defaultValue) ||
        (p.min !== undefined && p.defaultValue < p.min) || (p.max !== undefined && p.defaultValue > p.max))))) {
      setError('请检查数值参数是否在允许范围内'); return;
    }
    setError(''); onSave({ name, description, steps });
  };

  return <div className={styles.editor}>
    <p className={styles.description}>按列表顺序组合基础攻击；每一步都可以独立选择目标无人机。当前仅保存预设，不执行攻击。</p>
    <div className={styles.form}>
      <label>名称<input maxLength={40} value={name} onChange={event => setName(event.target.value)} placeholder="为组合命名" /></label>
      <label>说明<textarea maxLength={200} rows={2} value={description} onChange={event => setDescription(event.target.value)} /></label>
    </div>
    <div className={styles.addHeading}><h4>攻击步骤 ({steps.length})</h4><span>点击添加，可重复组合</span></div>
    <div className={styles.attackPicker} aria-label="添加基础攻击">
      {(Object.keys(typeLabels) as AttackType[]).map(type => <button key={type} type="button" disabled={steps.length >= 20} onClick={() => add(type)}><Plus size={13} />{typeLabels[type]}</button>)}
    </div>
    {!steps.length && <p className={styles.empty}>从上方添加第一种基础攻击</p>}
    <div className={styles.stepList}>
      {steps.map((step, index) => <section key={step.id} className={styles.step} aria-label={`步骤 ${index + 1} ${typeLabels[step.attackType]}`}>
        <header><b>{index + 1}. {typeLabels[step.attackType]}</b><div>
          <button type="button" aria-label={`上移步骤 ${index + 1}`} title="上移" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={15} /></button>
          <button type="button" aria-label={`下移步骤 ${index + 1}`} title="下移" disabled={index === steps.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} /></button>
          <button type="button" aria-label={`删除步骤 ${index + 1}`} title="删除步骤" onClick={() => setSteps(current => current.filter(item => item.id !== step.id))}><Trash2 size={15} /></button>
        </div></header>
        <label className={styles.stepSeverity}>强度<select aria-label={`步骤 ${index + 1} 强度`} value={step.severity} onChange={event => update(step.id, { severity: event.target.value as AttackSeverity })}>
          {Object.entries(severityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        {!!step.parameters.length && <div className={styles.stepParameters}>{step.parameters.map((p, paramIndex) => <label key={`${p.key}-${paramIndex}`}>{p.label}
          {p.type === 'boolean' ? <input type="checkbox" checked={Boolean(p.defaultValue)} onChange={event => update(step.id, { parameters: step.parameters.map((item, i) => i === paramIndex ? { ...item, defaultValue: event.target.checked } : item) })} />
            : p.type === 'select' && p.options?.length ? <select value={String(p.defaultValue)} onChange={event => update(step.id, { parameters: step.parameters.map((item, i) => i === paramIndex ? { ...item, defaultValue: event.target.value } : item) })}>{p.options.map(option => <option key={String(option.value)} value={option.value}>{option.label}</option>)}</select>
              : <input type={p.type === 'number' ? 'number' : 'text'} min={p.min} max={p.max} value={String(p.defaultValue)} onChange={event => update(step.id, { parameters: step.parameters.map((item, i) => i === paramIndex ? { ...item, defaultValue: p.type === 'number' ? event.target.value === '' ? '' : Number(event.target.value) : event.target.value } : item) })} />}
        </label>)}</div>}
        <div className={styles.targetsTitle}>目标无人机 <span>{step.targetDroneIds.length} 架已选 · 全机队可选</span></div>
        {step.targetDroneIds.filter(id => !drones.some(drone => drone.id === id)).map(id =>
          <div key={id} className={styles.invalidTarget}>当前机队无 {id}
            <button type="button" aria-label={`步骤 ${index + 1} 移除无效目标 ${id}`} onClick={() => update(step.id, { targetDroneIds: step.targetDroneIds.filter(target => target !== id) })}>移除</button>
          </div>)}
        <div className={styles.targets}>{drones.map(drone => <label key={drone.id}>
          <input type="checkbox" aria-label={`步骤 ${index + 1} 选择 ${drone.id}`} checked={step.targetDroneIds.includes(drone.id)} onChange={event => update(step.id, { targetDroneIds: event.target.checked ? [...step.targetDroneIds, drone.id] : step.targetDroneIds.filter(id => id !== drone.id) })} />{drone.id}
        </label>)}</div>
      </section>)}
    </div>
    {error && <p role="alert" className={styles.inlineError}>{error}</p>}
    <div className={styles.actions}><button type="button" onClick={onCancel}>取消</button><button type="button" className={styles.primary} onClick={save}>保存到攻击库</button></div>
  </div>;
}
