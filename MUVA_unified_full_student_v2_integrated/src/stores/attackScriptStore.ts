import { create } from 'zustand';
import { builtInAttackScripts } from '../mocks/attackScripts';
import type { AttackScript, AttackScriptParameter, AttackScriptStep, AttackSeverity, AttackType } from '../types/security';

const storageKey = 'muva:experiment3:attack-scripts:v1';
const attackTypes: readonly AttackType[] = ['GPS_SPOOFING', 'COMMAND_INJECTION', 'COMM_HIJACK', 'BATTERY_DRAIN', 'SENSOR_NOISE'];
const severities: readonly AttackSeverity[] = ['low', 'medium', 'high'];
const maxUploadBytes = 64 * 1024;

const storage = (): Storage | undefined => { try { return typeof window === 'undefined' ? undefined : window.localStorage; } catch { return undefined; } };
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const validType = (value: unknown): value is AttackType => typeof value === 'string' && attackTypes.includes(value as AttackType);
const validSeverity = (value: unknown): value is AttackSeverity => typeof value === 'string' && severities.includes(value as AttackSeverity);
const validTargets = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && /^uav\d{3,}$/.test(id)))].slice(0, 30) : [];

function parseParameters(value: unknown): AttackScriptParameter[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap(p => {
    if (!isRecord(p) || typeof p.key !== 'string' || typeof p.label !== 'string') return [];
    const type = p.type === 'number' || p.type === 'string' || p.type === 'boolean' || p.type === 'select' ? p.type : 'string';
    const defaultValue = typeof p.defaultValue === 'number' && Number.isFinite(p.defaultValue) || typeof p.defaultValue === 'boolean' || typeof p.defaultValue === 'string' ? p.defaultValue : '';
    const options = Array.isArray(p.options) ? p.options.filter((o): o is { label: string; value: string | number } => isRecord(o) && typeof o.label === 'string' && (typeof o.value === 'string' || typeof o.value === 'number')).slice(0, 20) : undefined;
    return [{ key: p.key.slice(0, 40), label: p.label.slice(0, 60), type, defaultValue, options,
      min: typeof p.min === 'number' && Number.isFinite(p.min) ? p.min : undefined,
      max: typeof p.max === 'number' && Number.isFinite(p.max) ? p.max : undefined }];
  });
}

export function attackSteps(script: AttackScript): AttackScriptStep[] {
  return script.steps ?? [{ id: `${script.id}-step`, attackType: script.attackType, severity: script.severity,
    parameters: script.parameters, targetDroneIds: [] }];
}

/** 从不可信输入（本地存储 / 上传文件）还原脚本；任何字段不合法都丢弃整条，且永远标记为自定义。 */
export function parseAttackScript(value: unknown): AttackScript | null {
  if (!isRecord(value)) return null;
  const { id, name, description, attackType, severity, tags, parameters, author, createdAt, updatedAt } = value;
  if (typeof name !== 'string' || !name.trim()) return null;
  if (value.steps !== undefined && (!Array.isArray(value.steps) || !value.steps.length || value.steps.length > 20)) return null;
  const steps: AttackScriptStep[] | null = Array.isArray(value.steps) ? value.steps.map((item, index) => {
    if (!isRecord(item) || !validType(item.attackType) || !validSeverity(item.severity)) return null;
    return { id: `step-${index}`, attackType: item.attackType, severity: item.severity,
      parameters: parseParameters(item.parameters), targetDroneIds: validTargets(item.targetDroneIds) };
  }).filter((item): item is AttackScriptStep => item !== null) : null;
  if (Array.isArray(value.steps) && steps?.length !== value.steps.length) return null;
  if (!steps && (!validType(attackType) || !validSeverity(severity))) return null;
  const first = steps?.[0];
  const resolvedType = first?.attackType ?? attackType as AttackType;
  const resolvedSeverity = first?.severity ?? severity as AttackSeverity;
  const resolvedParameters = first?.parameters ?? parseParameters(parameters);
  const now = Date.now();
  return {
    id: typeof id === 'string' && id.startsWith('custom-') ? id : `custom-${now}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim().slice(0, 40), description: typeof description === 'string' ? description.slice(0, 200) : '',
    attackType: resolvedType, severity: resolvedSeverity,
    tags: Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string').slice(0, 6).map(t => t.slice(0, 24)) : [],
    parameters: resolvedParameters,
    // 上传内容里的代码文本一律丢弃：脚本库只保存参数预设，不保存也不执行任意代码。
    executeCode: '', author: typeof author === 'string' ? author : '自定义',
    createdAt: typeof createdAt === 'number' ? createdAt : now, updatedAt: typeof updatedAt === 'number' ? updatedAt : now, isBuiltIn: false,
    steps: steps ?? [{ id: 'step-0', attackType: resolvedType, severity: resolvedSeverity, parameters: resolvedParameters,
      targetDroneIds: validTargets(value.targetDroneIds) }],
  };
}

function loadCustom(): AttackScript[] {
  try {
    const raw = storage()?.getItem(storageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.flatMap(item => { const script = parseAttackScript(item); return script ? [script] : []; }) : [];
  } catch { return []; }
}
const persist = (custom: AttackScript[]): boolean => { try { const target = storage(); if (!target) return false; target.setItem(storageKey, JSON.stringify(custom)); return true; } catch { return false; } };

interface AttackScriptState {
  custom: AttackScript[];
  selectedId: string | null;
  scripts(): AttackScript[];
  select(id: string | null): void;
  createCustom(draft: { name: string; description: string; steps: AttackScriptStep[] }): AttackScript;
  /** 解析上传的 JSON 文本；失败时返回错误说明。 */
  importText(text: string): { script?: AttackScript; error?: string };
  remove(id: string): void;
}

export const useAttackScriptStore = create<AttackScriptState>((set, get) => ({
  custom: loadCustom(), selectedId: null,
  scripts: () => [...builtInAttackScripts, ...get().custom],
  select: (id) => set({ selectedId: id }),
  createCustom: (draft) => {
    if (!draft.name.trim() || !draft.steps.length || draft.steps.some(step => !validType(step.attackType) || !validSeverity(step.severity) || !step.targetDroneIds.length)) {
      throw new Error('请填写名称，并为每个攻击步骤选择至少一架目标无人机');
    }
    const now = Date.now();
    const steps = draft.steps.map((step, index) => ({ ...step, id: `step-${index}`,
      parameters: step.parameters.map(parameter => ({ ...parameter })), targetDroneIds: [...step.targetDroneIds] }));
    const first = steps[0]!;
    const script: AttackScript = {
      id: `custom-${now}-${Math.random().toString(36).slice(2, 7)}`, name: draft.name.trim().slice(0, 40),
      description: draft.description.slice(0, 200), attackType: first.attackType, severity: first.severity,
      tags: [], parameters: first.parameters, steps, executeCode: '',
      author: '当前用户', createdAt: now, updatedAt: now, isBuiltIn: false,
    };
    const custom = [...get().custom, script];
    if (!persist(custom)) throw new Error('浏览器本地存储不可用，配置未保存');
    set({ custom, selectedId: script.id });
    return script;
  },
  importText: (text) => {
    if (text.length > maxUploadBytes) return { error: `文件超过 ${maxUploadBytes / 1024} KB 上限` };
    let data: unknown;
    try { data = JSON.parse(text); } catch { return { error: '不是有效的 JSON 文件' }; }
    const script = parseAttackScript(data);
    if (!script) return { error: '缺少必填字段：name、attackType、severity，或取值不合法' };
    const unique = get().scripts().some(s => s.id === script.id) ? { ...script, id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` } : script;
    const custom = [...get().custom, unique];
    if (!persist(custom)) return { error: '浏览器本地存储不可用，导入未保存' };
    set({ custom, selectedId: unique.id });
    return { script: unique };
  },
  remove: (id) => {
    const custom = get().custom.filter(s => s.id !== id);
    if (!persist(custom)) throw new Error('浏览器本地存储不可用，删除失败');
    set({ custom, selectedId: get().selectedId === id ? null : get().selectedId });
  },
}));
