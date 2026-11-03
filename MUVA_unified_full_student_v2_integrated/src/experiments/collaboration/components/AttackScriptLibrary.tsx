import { useEffect, useRef, useState } from 'react';
import { Check, FilePlus2, FolderOpen, Search, ShieldAlert, Trash2, Upload, X } from 'lucide-react';
import { attackSteps, useAttackScriptStore } from '../../../stores/attackScriptStore';
import { useCollaborationStore } from '../../../stores/collaborationStore';
import type { AttackScript, AttackType } from '../../../types/security';
import { AttackCombinationEditor } from './AttackCombinationEditor';
import styles from './AttackScriptLibrary.module.css';

const typeLabels: Record<AttackType, string> = {
  GPS_SPOOFING: 'GPS 欺骗', COMMAND_INJECTION: '命令注入', COMM_HIJACK: '通信劫持',
  BATTERY_DRAIN: '电量攻击', SENSOR_NOISE: '传感器干扰',
};
const severityLabels = { low: '轻微', medium: '中等', high: '严重' };

export function AttackScriptLibrary({ onClose, onUse }: { onClose: () => void; onUse: (script: AttackScript) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const custom = useAttackScriptStore(s => s.custom);
  const selectedId = useAttackScriptStore(s => s.selectedId);
  const library = useAttackScriptStore();
  const droneIds = useCollaborationStore(s => s.missionState.drones).map(drone => drone.id);
  const scripts = library.scripts();
  const [focusedId, setFocusedId] = useState(selectedId ?? scripts[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'all' | 'builtIn' | 'custom'>('all');
  const [mode, setMode] = useState<'browse' | 'create'>('browse');
  const [baseId, setBaseId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const focused = scripts.find(script => script.id === focusedId) ?? scripts[0];
  const invalidTargets = focused && !focused.isBuiltIn ? attackSteps(focused).flatMap((step, index) =>
    !step.targetDroneIds.length ? [`步骤 ${index + 1} 未指定目标`] : step.targetDroneIds.filter(id => !droneIds.includes(id)).map(id => `步骤 ${index + 1} 的 ${id} 不在当前机队`)) : [];
  const base = baseId ? scripts.find(script => script.id === baseId) ?? null : null;
  const visible = scripts.filter(script => (category === 'all' || (category === 'builtIn') === script.isBuiltIn) &&
    `${script.name} ${script.description} ${attackSteps(script).map(step => typeLabels[step.attackType]).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => { if (node?.open) node.close(); };
  }, []);

  const beginCreate = (source: AttackScript | null) => {
    setBaseId(source?.id ?? null);
    setError(''); setMessage(''); setMode('create');
  };
  const save = (draft: { name: string; description: string; steps: ReturnType<typeof attackSteps> }) => {
    try {
      const script = library.createCustom(draft);
      setFocusedId(script.id); setCategory('custom'); setQuery(''); setMode('browse');
      setError(''); setMessage('组合已保存到浏览器；不会执行攻击代码。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '配置保存失败'); }
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError(''); setMessage('');
    if (!file.name.toLowerCase().endsWith('.json')) { setError('请选择 JSON 格式的配置文件'); return; }
    if (file.size > 64 * 1024) { setError('文件不能超过 64 KB'); return; }
    try {
      const result = library.importText(await file.text());
      if (result.error) { setError(result.error); return; }
      if (result.script) {
        setFocusedId(result.script.id); setCategory('custom'); setQuery(''); setMode('browse');
        setMessage('已导入配置；上传文件中的代码不会保存或执行。请检查每一步的目标无人机。');
      }
    } catch { setError('读取文件失败，请重试'); }
  };
  const remove = () => {
    if (!focused || focused.isBuiltIn || !window.confirm(`删除自定义配置“${focused.name}”？`)) return;
    try {
      library.remove(focused.id); setFocusedId(scripts.find(s => s.id !== focused.id)?.id ?? '');
      setMessage('已删除自定义配置'); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '删除失败'); }
  };

  return <dialog ref={dialog} className={styles.dialog} aria-label="攻击库" onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}>
    <header className={styles.header}>
      <div className={styles.heading}><ShieldAlert size={21} /><div><h2>攻击库</h2><span>实验三 · 基础演示与自定义组合</span></div></div>
      <button type="button" className={styles.iconButton} aria-label="关闭攻击库" onClick={onClose}><X size={19} /></button>
    </header>
    <div className={styles.notice}>前端演示：仅选择、上传和保存攻击配置，不执行上传代码，也不向无人机发送攻击指令。</div>
    <div className={styles.body}>
      <section className={styles.catalog} aria-label="脚本列表">
        <label className={styles.search}><Search size={16} /><input aria-label="搜索攻击配置" placeholder="搜索名称或类型" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <div className={styles.filters} aria-label="配置来源">
          {([['all', '全部'], ['builtIn', '基础'], ['custom', `自定义 ${custom.length}`]] as const).map(([key, label]) =>
            <button key={key} type="button" aria-pressed={category === key} onClick={() => setCategory(key)}>{label}</button>)}
        </div>
        <div className={styles.newCombination}><button type="button" onClick={() => beginCreate(null)}><FilePlus2 size={15} />新建组合攻击</button></div>
        <div className={styles.list}>
          {visible.map(script => <button key={script.id} type="button" className={styles.item} aria-pressed={focused?.id === script.id} onClick={() => { setFocusedId(script.id); setMode('browse'); setError(''); setMessage(''); }}>
            <span className={styles.itemIcon}><FolderOpen size={17} /></span><span><b>{script.name}</b><small>{script.isBuiltIn ? `${typeLabels[script.attackType]} · ${severityLabels[script.severity]}` : `${attackSteps(script).length} 项攻击 · ${[...new Set(attackSteps(script).flatMap(step => step.targetDroneIds))].length} 架目标`}</small></span><em>{script.isBuiltIn ? '演示' : '自定义'}</em>
          </button>)}
          {!visible.length && <p className={styles.empty}>没有匹配的攻击配置</p>}
        </div>
        <div className={styles.import}><input ref={fileInput} type="file" accept=".json,application/json" aria-label="上传攻击配置 JSON" onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }} /><button type="button" onClick={() => fileInput.current?.click()}><Upload size={16} />上传 JSON 配置</button></div>
      </section>
      <section className={styles.details} aria-label="配置详情">
        {mode === 'create' ? <>
          <div className={styles.detailsHead}><div><small>{base ? '从现有配置复制' : '从零开始'}</small><h3>{base ? `基于 ${base.name} 创建` : '新建组合攻击'}</h3></div></div>
          <AttackCombinationEditor key={baseId ?? 'new'} base={base} templates={scripts.filter(script => script.isBuiltIn)} onSave={save} onCancel={() => { setMode('browse'); setError(''); }} />
        </> : focused && <>
          <div className={styles.detailsHead}><div><small>{focused.isBuiltIn ? '基础攻击 · 演示模板' : '自定义组合 · 本地保存'}</small><h3>{focused.name}</h3></div>{!focused.isBuiltIn && <button type="button" className={styles.iconButton} title="删除自定义配置" aria-label="删除自定义配置" onClick={remove}><Trash2 size={17} /></button>}</div>
            <p className={styles.description}>{focused.description || '暂无描述'}</p>
            <h4>攻击步骤 ({attackSteps(focused).length})</h4>
            <div className={styles.previewSteps}>{attackSteps(focused).map((step, index) => <div key={step.id}><b>{index + 1}. {typeLabels[step.attackType]} <small>{severityLabels[step.severity]}</small></b>
              <span>目标：{step.targetDroneIds.length ? step.targetDroneIds.map(id => droneIds.includes(id) ? id : `${id}（当前机队无此机）`).join('、') : focused.isBuiltIn ? '基础演示未指定目标' : '未指定，请复制并选择目标'}</span>
              {!!step.parameters.length && <small>{step.parameters.map(p => `${p.label}: ${String(p.defaultValue)}`).join(' · ')}</small>}
            </div>)}</div>
            {!!invalidTargets?.length && <p role="alert" className={styles.inlineError}>{invalidTargets.join('；')}。请基于此配置创建并修正目标后再选择。</p>}
            <div className={styles.actions}>{!focused.isBuiltIn && <button type="button" onClick={() => beginCreate(focused)}><FilePlus2 size={16} />基于此配置创建</button>}<button type="button" className={styles.primary} disabled={!!invalidTargets?.length} onClick={() => { if (focused.isBuiltIn) { beginCreate(focused); return; } library.select(focused.id); onUse(focused); }}><Check size={16} />{focused.isBuiltIn ? '配置此模板' : '选择此配置'}</button></div>
        </>}
      </section>
    </div>
    {(error || message) && <div role={error ? 'alert' : 'status'} className={error ? styles.error : styles.message}>{error || message}</div>}
  </dialog>;
}
