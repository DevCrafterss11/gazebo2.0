import { defaultDroneType, defaultPayload, isDronePayload, isDroneType, seatsFor } from '../../domain/collaborationResources';
import { taskRoles } from '../../domain/collaborationMission';
import type { ArrayLayout, Drone, DronePayload, DroneType, Mission, TaskType } from '../../types/collaboration';

export const collaborationPreferencesKey = 'muva:collaboration:preferences:v2';
/** Version 1 stored model/components/allowedTaskTypes/enabled. It is read once, converted, and removed after v2 is saved. */
export const legacyPreferencesKey = 'muva:collaboration:preferences:v1';
export interface PreferenceStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export interface CollaborationPreferences {
  version: 2;
  arrayLayout: ArrayLayout;
  resources: { id: string; droneType: DroneType; payload: DronePayload; visibleOnMap: boolean }[];
  groups: { id: string; drones: string[]; roles: Record<string, string>; mode: string }[];
}
export interface RestoredPreferences {
  mission: Mission; layout: ArrayLayout; status: string;
  /** True when the data came from v1 (or was repaired) and should be written back as v2 right away. */
  migrated: boolean;
  /** Members dropped because they no longer fit their seat, e.g. "uav104 → 物资运输". */
  dropped: string[];
}
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export function browserPreferenceStorage(): PreferenceStorage | undefined {
  try {
    if (typeof window === 'undefined') return undefined;
    // Only configuration, never telemetry, survives a login. Keep each demo account separate.
    // Old unscoped keys are deliberately not imported into an arbitrary new account.
    const account = window.sessionStorage.getItem('muva-mock-user') === 'signed-in'
      ? window.sessionStorage.getItem('muva-username') ?? 'unknown' : 'guest';
    const key = (name: string) => `${name}:account:${encodeURIComponent(account)}`;
    // Before account isolation, this browser held a single unscoped teaching configuration.
    // Only the original student demo account may claim it. Copy first, delete only after
    // the scoped write succeeds; other users must never inherit a previous student's team.
    if (account === 'student01' && window.localStorage.getItem(key(collaborationPreferencesKey)) === null
      && window.localStorage.getItem(key(legacyPreferencesKey)) === null) {
      for (const name of [collaborationPreferencesKey, legacyPreferencesKey]) {
        const previous = window.localStorage.getItem(name);
        if (previous !== null) {
          window.localStorage.setItem(key(name), previous);
          window.localStorage.removeItem(name);
          break;
        }
      }
    }
    return { getItem: name => window.localStorage.getItem(key(name)),
      setItem: (name, value) => window.localStorage.setItem(key(name), value),
      removeItem: name => window.localStorage.removeItem(key(name)) };
  } catch { return undefined; }
}
/** Explicit whitelist: never persist telemetry, positions, plans, acknowledgements or armed state. */
export function captureCollaborationPreferences(mission: Mission, arrayLayout: ArrayLayout): CollaborationPreferences {
  return { version: 2, arrayLayout: { ...arrayLayout }, resources: mission.drones.map(d => ({ id: d.id, droneType: d.droneType, payload: d.payload, visibleOnMap: d.visibleOnMap })),
    groups: mission.groups.map(g => ({ id: g.id, drones: [...g.drones], roles: Object.fromEntries(g.drones.map(id => [id, g.roles[id] ?? ''])), mode: g.mode })) };
}

/** v1 never had a type or payload. Derive the closest loadout from the tasks the old data allowed, else use the fleet default. */
function legacyLoadout(saved: Record<string, unknown> | undefined, fallback: Pick<Drone, 'droneType' | 'payload'>): Pick<Drone, 'droneType' | 'payload'> {
  const allowed = Array.isArray(saved?.allowedTaskTypes) ? saved.allowedTaskTypes.filter((t): t is string => typeof t === 'string') : [];
  const carries = allowed.some(t => t === '物资运输' || t === '应急救援') && !allowed.some(t => t === '区域巡逻' || t === '目标搜索' || t === '定点监测');
  if (carries) return { droneType: '运输', payload: defaultPayload['运输'] };
  return fallback;
}

export function restoreCollaborationPreferences(mission: Mission, layout: ArrayLayout, storage = browserPreferenceStorage()): RestoredPreferences {
  const unchanged = (status: string): RestoredPreferences => ({ mission, layout, status, migrated: false, dropped: [] });
  if (!storage) return unchanged('浏览器存储不可用，仅本次会话有效');
  try {
    const current = storage.getItem(collaborationPreferencesKey);
    const text = current ?? storage.getItem(legacyPreferencesKey);
    if (!text) return unchanged('配置自动保存至本机浏览器');
    const legacy = current === null;
    const data: unknown = JSON.parse(text);
    if (!object(data) || data.version !== (legacy ? 1 : 2) || !Array.isArray(data.resources) || !Array.isArray(data.groups) || !object(data.arrayLayout)) throw new Error('无效配置');
    const savedLayout = data.arrayLayout;
    const keys = ['centerX', 'centerY', 'columnSpacing', 'rowSpacing', 'altitude'] as const;
    if (!keys.every(k => typeof savedLayout[k] === 'number' && Number.isFinite(savedLayout[k])) || Number(savedLayout.columnSpacing) < 5 || Number(savedLayout.rowSpacing) < 5 || Number(savedLayout.altitude) < 0 || keys.some(k => Math.abs(Number(savedLayout[k])) > 20000)) throw new Error('阵列配置无效');
    const nextLayout: ArrayLayout = { centerX: Number(savedLayout.centerX), centerY: Number(savedLayout.centerY), columnSpacing: Number(savedLayout.columnSpacing), rowSpacing: Number(savedLayout.rowSpacing), altitude: Number(savedLayout.altitude) };
    const resources = data.resources.filter(object), groups = data.groups.filter(object);
    const drones = mission.drones.map((d, i) => {
      const saved = resources.find(r => r.id === d.id);
      const position = { x: nextLayout.centerX + (i % 5 - 2) * nextLayout.columnSpacing, y: nextLayout.centerY + (1 - Math.floor(i / 5)) * nextLayout.rowSpacing, z: nextLayout.altitude };
      const base = { droneType: defaultDroneType(i), payload: defaultPayload[defaultDroneType(i)] };
      const loadout = legacy ? legacyLoadout(saved, base)
        : { droneType: isDroneType(saved?.droneType) ? saved.droneType : base.droneType, payload: isDronePayload(saved?.payload) ? saved.payload : base.payload };
      // The old "地图" checkbox is gone; a drone hidden under v1 would otherwise stay invisible with no way back.
      const visibleOnMap = legacy ? true : typeof saved?.visibleOnMap === 'boolean' ? saved.visibleOnMap : d.visibleOnMap;
      return { ...d, position, homePosition: { ...position }, ...loadout, visibleOnMap, mapVisible: visibleOnMap };
    });
    const dropped: string[] = [];
    const restoredGroups = mission.groups.map((g, i) => {
      const saved = groups.find(r => r.id === g.id), roles: Record<string, string> = {};
      const type = mission.tasks[i]!.type as TaskType;
      const wanted = Array.isArray(saved?.drones) ? [...new Set(saved.drones.filter((id): id is string => typeof id === 'string' && drones.some(d => d.id === id)))] : [];
      const ids = wanted.filter(id => {
        const drone = drones.find(d => d.id === id)!;
        const fits = seatsFor(drone, type).length > 0;
        if (!fits) dropped.push(`${id} → ${type}`);
        return fits;
      });
      ids.forEach(id => {
        const drone = drones.find(d => d.id === id)!, role = object(saved?.roles) ? saved.roles[id] : undefined;
        const seats = seatsFor(drone, type).map(seat => seat.role);
        roles[id] = typeof role === 'string' && taskRoles[i]!.includes(role) && seats.includes(role) ? role : seats[0]!;
      });
      return { ...g, drones: ids, roles, mode: saved?.mode === 'SYNC' || saved?.mode === 'LEADER' || saved?.mode === 'RELAY' ? saved.mode : g.mode };
    });
    const status = legacy
      ? dropped.length ? `已从旧版配置迁移；${dropped.length} 个编组成员不再适配，已移出：${dropped.join('、')}` : '已从旧版配置迁移；飞行状态未恢复'
      : dropped.length ? `已恢复本机编组配置；${dropped.length} 个成员不再适配已移出：${dropped.join('、')}` : '已恢复本机编组配置；飞行状态未恢复';
    return { layout: nextLayout, status, migrated: legacy || dropped.length > 0, dropped, mission: { ...mission, drones, groups: restoredGroups } };
  } catch { return unchanged('本机配置损坏或版本不兼容，已安全使用初始配置'); }
}
export function saveCollaborationPreferences(preferences: CollaborationPreferences, storage = browserPreferenceStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(collaborationPreferencesKey, JSON.stringify(preferences));
    // Remove v1 only after v2 is safely stored, so a failed write never loses the old data.
    try { storage.removeItem(legacyPreferencesKey); } catch { /* ignore */ }
    return true;
  } catch { return false; }
}
