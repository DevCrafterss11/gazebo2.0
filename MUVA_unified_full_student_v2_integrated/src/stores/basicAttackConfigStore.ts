import { create } from 'zustand';
import type { AttackType } from '../types/security';
import { parseBasicAttackConfig, validateAttackConfig, type BasicAttackConfig } from '../domain/basicAttackConfig';

export const basicAttackStorageKey = 'muva:experiment3:basic-attack-configs:v1';
type Configs = Partial<Record<AttackType, BasicAttackConfig>>;
function load(): Configs {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(basicAttackStorageKey) ?? '[]');
    if (!Array.isArray(raw)) return {};
    return Object.fromEntries(raw.map(parseBasicAttackConfig).filter((item): item is BasicAttackConfig => item !== null).map(item => [item.attackType, item]));
  } catch { return {}; }
}
interface ConfigState {
  configs: Configs;
  save: (config: BasicAttackConfig, availableTargets: string[]) => void;
}
export const useBasicAttackConfigStore = create<ConfigState>((set, get) => ({
  configs: load(),
  save: (config, availableTargets) => {
    if (Object.keys(validateAttackConfig(config, availableTargets)).length) throw new Error('配置有误，请检查表单');
    const parsed = parseBasicAttackConfig(config);
    if (!parsed) throw new Error('配置格式无效，请检查输入');
    const next = { ...get().configs, [config.attackType]: parsed };
    // Write first: a storage failure leaves the saved state intact and the dialog open.
    try { window.localStorage.setItem(basicAttackStorageKey, JSON.stringify(Object.values(next))); }
    catch { throw new Error('本地保存失败，请检查浏览器存储空间或权限。当前输入已保留。'); }
    set({ configs: next });
  },
}));
