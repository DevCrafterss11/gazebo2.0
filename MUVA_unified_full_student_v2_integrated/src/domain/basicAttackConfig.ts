import type { AttackScriptParameter, AttackSeverity, AttackType } from '../types/security';

export const attackLabels: Record<AttackType, string> = {
  GPS_SPOOFING: 'GPS 欺骗', COMMAND_INJECTION: '命令注入', COMM_HIJACK: '通信劫持',
  BATTERY_DRAIN: '电量攻击', SENSOR_NOISE: '传感器干扰',
};
export type ConfigValue = AttackScriptParameter['defaultValue'];
export interface DroneAttackParameters {
  severity: AttackSeverity;
  values: Record<string, ConfigValue>;
}
export interface BasicAttackConfig {
  attackType: AttackType;
  name: string;
  description: string;
  severity: AttackSeverity;
  targetDroneIds: string[];
  /** Missing entries use the shared preset, including legacy saved configurations. */
  droneConfigs?: Record<string, DroneAttackParameters>;
  values: Record<string, ConfigValue>;
}
export interface ConfigField extends AttackScriptParameter {
  group: string;
  unit?: string;
  multiline?: boolean;
  visibleWhen?: { key: string; values: string[] };
}
const number = (key: string, label: string, group: string, defaultValue: number, min: number, max: number, unit = ''): ConfigField =>
  ({ key, label, group, type: 'number', defaultValue, min, max, unit });
const select = (key: string, label: string, group: string, options: [[string, string], ...[string, string][]]): ConfigField =>
  ({ key, label, group, type: 'select', defaultValue: options[0][0], options: options.map(([value, text]) => ({ value, label: text })) });
const toggle = (key: string, label: string, group: string, defaultValue: boolean): ConfigField =>
  ({ key, label, group, type: 'boolean', defaultValue });
const common: ConfigField[] = [
  number('delay', '启动延迟', '时间与调度', 0, 0, 3600, 's'),
  number('duration', '持续时间', '时间与调度', 60, 1, 3600, 's'),
  number('interval', '更新间隔', '时间与调度', 100, 10, 10000, 'ms'),
  number('seed', '随机种子', '记录与停止条件', 42, 0, 2147483647),
  select('disconnect', '目标断连处理', '记录与停止条件', [['stop', '停止场景'], ['pause', '暂停等待'], ['continue', '继续记录']]),
  toggle('stopOnLimit', '超限停止', '记录与停止条件', true),
  select('logLevel', '日志级别', '记录与停止条件', [['info', '信息'], ['debug', '调试'], ['warn', '仅警告']]),
  toggle('record', '记录遥测与轨迹', '记录与停止条件', true),
];
const specific: Record<AttackType, ConfigField[]> = {
  GPS_SPOOFING: [
    select('mode', '位置变化模式', '位置与轨迹', [['static', '静态偏移'], ['gradual', '渐变偏移'], ['path', '路径回放']]),
    { ...number('offsetX', '东向偏移', '位置与轨迹', 10, -10000, 10000, 'm'), visibleWhen: { key: 'mode', values: ['static', 'gradual'] } },
    { ...number('offsetY', '北向偏移', '位置与轨迹', 10, -10000, 10000, 'm'), visibleWhen: { key: 'mode', values: ['static', 'gradual'] } },
    { ...number('offsetZ', '高度偏移', '位置与轨迹', 0, -1000, 1000, 'm'), visibleWhen: { key: 'mode', values: ['static', 'gradual'] } },
    number('latitude', '参考纬度', '位置与轨迹', 31.2304, -90, 90, '°'),
    number('longitude', '参考经度', '位置与轨迹', 121.4737, -180, 180, '°'),
    number('altitude', '参考高度', '位置与轨迹', 50, 0, 10000, 'm'),
    { ...number('ramp', '渐变时长', '位置与轨迹', 10, 1, 3600, 's'), visibleWhen: { key: 'mode', values: ['gradual'] } },
    { ...select('interpolation', '插值方式', '位置与轨迹', [['linear', '线性'], ['smooth', '平滑']]), visibleWhen: { key: 'mode', values: ['gradual', 'path'] } },
    { key: 'waypoints', label: '路径点', type: 'string', group: '位置与轨迹', defaultValue: '0,0,0\n20,10,0\n30,30,5', multiline: true,
      description: '每行填写东向、北向、高度偏移（米），英文逗号分隔，2–100 个点。', visibleWhen: { key: 'mode', values: ['path'] } },
    { ...toggle('loop', '循环回放', '位置与轨迹', false), visibleWhen: { key: 'mode', values: ['path'] } },
    number('noise', '位置噪声幅度', '位置与轨迹', 0, 0, 100, 'm'),
    number('maxOffset', '最大水平偏移', '边界限制', 200, 1, 20000, 'm'),
    number('minAltitude', '最低高度', '边界限制', 0, 0, 10000, 'm'),
    number('maxAltitude', '最高高度', '边界限制', 500, 0, 10000, 'm'),
    toggle('geofence', '启用仿真地理围栏', '边界限制', true),
    { ...number('fenceRadius', '围栏半径', '边界限制', 500, 1, 20000, 'm'), visibleWhen: { key: 'geofence', values: ['true'] } },
  ],
  COMMAND_INJECTION: [
    select('command', '模拟指令', '指令场景', [['hold', '悬停'], ['return', '返航'], ['land', '降落']]),
    select('delivery', '触发方式', '指令场景', [['once', '单次'], ['repeat', '重复']]),
    { ...number('repeatInterval', '重复间隔', '指令场景', 5, 1, 300, 's'), visibleWhen: { key: 'delivery', values: ['repeat'] } },
    { ...number('repeatCount', '重复次数', '指令场景', 3, 1, 100), visibleWhen: { key: 'delivery', values: ['repeat'] } },
    number('commandDelay', '模拟指令延迟', '指令场景', 100, 0, 10000, 'ms'),
    number('acceptance', '模拟接受概率', '指令场景', 0.5, 0, 1),
    toggle('acknowledge', '记录模拟应答', '指令场景', true),
    toggle('restore', '结束后恢复任务', '指令场景', true),
  ],
  COMM_HIJACK: [
    select('linkMode', '链路异常模式', '链路场景', [['loss', '随机丢包'], ['latency', '延迟与抖动'], ['outage', '间歇中断']]),
    number('packetLoss', '丢包率', '链路场景', 0.3, 0, 1),
    number('latency', '链路延迟', '链路场景', 200, 0, 10000, 'ms'),
    number('jitter', '延迟抖动', '链路场景', 50, 0, 5000, 'ms'),
    number('duplicate', '重复包比例', '链路场景', 0, 0, 1),
    { ...number('outageDuration', '单次中断时长', '链路场景', 5, 1, 300, 's'), visibleWhen: { key: 'linkMode', values: ['outage'] } },
    { ...number('recoveryInterval', '恢复间隔', '链路场景', 10, 1, 300, 's'), visibleWhen: { key: 'linkMode', values: ['outage'] } },
    select('channel', '观测通道', '链路场景', [['telemetry', '遥测'], ['heartbeat', '心跳'], ['all', '全部模拟通道']]),
    toggle('autoRecover', '结束后恢复链路', '链路场景', true),
  ],
  BATTERY_DRAIN: [
    select('drainMode', '电量变化模式', '电量场景', [['continuous', '持续消耗'], ['step', '阶跃下降']]),
    { ...number('multiplier', '额外耗电倍率', '电量场景', 2, 1, 20), visibleWhen: { key: 'drainMode', values: ['continuous'] } },
    { ...number('drain', '单次下降电量', '电量场景', 20, 1, 80, '%'), visibleWhen: { key: 'drainMode', values: ['step'] } },
    number('initialBattery', '场景初始电量', '电量场景', 100, 1, 100, '%'),
    number('warningBattery', '低电量告警阈值', '电量场景', 30, 1, 100, '%'),
    number('stopBattery', '停止电量阈值', '电量场景', 15, 0, 99, '%'),
    number('voltageDrop', '模拟电压下降', '电量场景', 0.5, 0, 10, 'V'),
    toggle('protectBattery', '触发阈值时停止场景', '电量场景', true),
    toggle('recordVoltage', '记录电压变化', '电量场景', true),
  ],
  SENSOR_NOISE: [
    select('sensor', '传感器通道', '传感器场景', [['imu', '惯性测量单元'], ['gyro', '陀螺仪'], ['attitude', '姿态估计']]),
    select('distribution', '噪声分布', '传感器场景', [['gaussian', '高斯分布'], ['uniform', '均匀分布'], ['bias', '固定偏置']]),
    number('roll', '横滚噪声幅度', '传感器场景', 5, 0, 45, '°'),
    number('pitch', '俯仰噪声幅度', '传感器场景', 5, 0, 45, '°'),
    number('yaw', '偏航噪声幅度', '传感器场景', 10, 0, 180, '°'),
    number('bias', '固定姿态偏置', '传感器场景', 0, -45, 45, '°'),
    number('drift', '漂移速率', '传感器场景', 0.1, 0, 10, '°/s'),
    number('dropout', '样本缺失率', '传感器场景', 0, 0, 1),
    toggle('correlated', '轴间噪声关联', '传感器场景', false),
  ],
};
export function configFields(type: AttackType): ConfigField[] { return [...specific[type], ...common]; }
export function fieldVisible(field: ConfigField, values: BasicAttackConfig['values']): boolean {
  return !field.visibleWhen || field.visibleWhen.values.includes(String(values[field.visibleWhen.key]));
}
export function defaultAttackConfig(attackType: AttackType): BasicAttackConfig {
  return { attackType, name: `${attackLabels[attackType]}配置`, description: '', severity: 'medium', targetDroneIds: [],
    values: Object.fromEntries(configFields(attackType).map(field => [field.key, field.defaultValue])) };
}
export type PositionPoint = [number, number, number];
export function parseWaypoints(text: string): PositionPoint[] | null {
  const lines = text.trim().split('\n');
  if (lines.length < 2 || lines.length > 100) return null;
  const points = lines.map(line => line.split(',').map(item => item.trim() === '' ? NaN : Number(item)));
  const valid = (p: number[]): p is PositionPoint => p.length === 3 && p.every(Number.isFinite) && Math.abs(p[0] ?? Infinity) <= 10000 && Math.abs(p[1] ?? Infinity) <= 10000 && Math.abs(p[2] ?? Infinity) <= 1000;
  return points.every(valid) ? points : null;
}
function validateSingleAttackConfig(config: BasicAttackConfig, availableTargets?: string[]): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!config.name.trim() || config.name.length > 40) errors.name = '请输入 1–40 字的配置名称';
  if (config.description.length > 200) errors.description = '场景说明不能超过 200 字';
  if (!['low', 'medium', 'high'].includes(config.severity)) errors.severity = '请选择有效强度';
  if (availableTargets && config.targetDroneIds.some(id => !availableTargets.includes(id))) errors.targets = '部分目标已离开当前任务，请移除失效目标后保存';
  for (const field of configFields(config.attackType)) {
    if (!fieldVisible(field, config.values)) continue;
    const value = config.values[field.key];
    if (field.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || value < (field.min ?? -Infinity) || value > (field.max ?? Infinity))) errors[field.key] = `请输入 ${field.min}–${field.max} 范围内的数值`;
    if (field.type === 'select' && !field.options?.some(option => option.value === value)) errors[field.key] = '请选择有效选项';
    if (field.type === 'boolean' && typeof value !== 'boolean') errors[field.key] = '开关值无效';
    if (field.type === 'string' && (typeof value !== 'string' || value.length > 6000)) errors[field.key] = '文本格式或长度无效';
  }
  const v = config.values;
  if (Number(v.interval) > Number(v.duration) * 1000) errors.interval = '更新间隔不能超过持续时间';
  if (!Number.isInteger(v.seed)) errors.seed = '随机种子必须为整数';
  if (config.attackType === 'GPS_SPOOFING') {
    if (v.mode === 'gradual' && Number(v.ramp) > Number(v.duration)) errors.ramp = '渐变时长不能超过持续时间';
    if (Number(v.minAltitude) > Number(v.maxAltitude)) errors.maxAltitude = '最高高度不能低于最低高度';
    const positions: PositionPoint[] = v.mode === 'path' ? [] : [[Number(v.offsetX), Number(v.offsetY), Number(v.offsetZ)]];
    if (v.mode === 'path') {
      const points = typeof v.waypoints === 'string' ? parseWaypoints(v.waypoints) : null;
      if (!points) errors.waypoints = '请输入 2–100 行有效路径点，水平偏移 ±10000 m、高度偏移 ±1000 m';
      else positions.push(...points);
    }
    for (const [x, y, z] of positions) {
      if (Math.hypot(x, y) > Number(v.maxOffset)) errors[v.mode === 'path' ? 'waypoints' : 'maxOffset'] = '水平偏移超出最大偏移限制';
      if (v.geofence && Math.hypot(x, y) > Number(v.fenceRadius)) errors.fenceRadius = '围栏半径必须包含全部偏移位置';
      if (Number(v.altitude) + z < Number(v.minAltitude) || Number(v.altitude) + z > Number(v.maxAltitude)) errors.altitude = '参考高度加高度偏移必须位于高度限制内';
    }
  }
  if (config.attackType === 'BATTERY_DRAIN') {
    if (Number(v.stopBattery) >= Number(v.warningBattery)) errors.stopBattery = '停止阈值必须低于告警阈值';
    if (Number(v.warningBattery) > Number(v.initialBattery)) errors.warningBattery = '告警阈值不能高于初始电量';
  }
  if (config.attackType === 'COMMAND_INJECTION' && v.delivery === 'repeat' && !Number.isInteger(v.repeatCount)) errors.repeatCount = '重复次数必须为整数';
  return errors;
}

/** Resolve a detached execution snapshot; per-drone settings never share mutable values. */
export function resolveDroneAttackConfig(config: BasicAttackConfig, droneId: string): BasicAttackConfig {
  const parameters = config.attackType === 'GPS_SPOOFING' && config.droneConfigs && Object.hasOwn(config.droneConfigs, droneId)
    ? config.droneConfigs[droneId] : undefined;
  return { attackType: config.attackType, name: config.name, description: config.description,
    targetDroneIds: [droneId], severity: parameters?.severity ?? config.severity,
    values: { ...config.values, ...parameters?.values } };
}

export function validateAttackConfig(config: BasicAttackConfig, availableTargets?: string[]): Record<string, string> {
  if (config.attackType !== 'GPS_SPOOFING' || !config.droneConfigs || !config.targetDroneIds.length)
    return validateSingleAttackConfig(config, availableTargets);
  const errors: Record<string, string> = {};
  for (const id of config.targetDroneIds) {
    const local = validateSingleAttackConfig(resolveDroneAttackConfig(config, id), availableTargets);
    for (const [key, message] of Object.entries(local)) {
      const shared = ['name', 'description', 'targets'].includes(key);
      errors[shared ? key : `drone:${id}:${key}`] = shared ? message : `${id}：${message}`;
    }
  }
  return errors;
}

/** Restore only known, typed fields; malformed persisted records never reach the form. */
export function parseBasicAttackConfig(value: unknown): BasicAttackConfig | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.attackType !== 'string' || !Object.hasOwn(attackLabels, raw.attackType)) return null;
  const result = defaultAttackConfig(raw.attackType as AttackType);
  if (typeof raw.name !== 'string' || typeof raw.description !== 'string' || !Array.isArray(raw.targetDroneIds) || !raw.targetDroneIds.every(id => typeof id === 'string')) return null;
  if (raw.severity !== 'low' && raw.severity !== 'medium' && raw.severity !== 'high') return null;
  result.name = raw.name; result.description = raw.description; result.severity = raw.severity;
  result.targetDroneIds = [...new Set(raw.targetDroneIds)];
  if (!raw.values || typeof raw.values !== 'object') return null;
  const values = raw.values as Record<string, unknown>;
  for (const field of configFields(result.attackType)) {
    const v = values[field.key];
    if (v === undefined) continue;
    if (typeof v !== typeof field.defaultValue || (typeof v === 'number' && !Number.isFinite(v))) return null;
    if (field.type === 'select' && !field.options?.some(option => option.value === v)) return null;
    result.values[field.key] = v as ConfigValue;
  }
  if (raw.droneConfigs !== undefined && result.attackType === 'GPS_SPOOFING') {
    if (!raw.droneConfigs || typeof raw.droneConfigs !== 'object' || Array.isArray(raw.droneConfigs)) return null;
    const entries = raw.droneConfigs as Record<string, unknown>;
    result.droneConfigs = {};
    for (const id of result.targetDroneIds) {
      if (!Object.hasOwn(entries, id)) continue;
      const entry = entries[id];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const parameters = entry as Record<string, unknown>;
      const parsed = parseBasicAttackConfig({ ...result, droneConfigs: undefined,
        targetDroneIds: [id], severity: parameters.severity, values: parameters.values });
      if (!parsed) return null;
      Object.defineProperty(result.droneConfigs, id, { value: { severity: parsed.severity, values: parsed.values }, enumerable: true, writable: true, configurable: true });
    }
  }
  return Object.keys(validateAttackConfig(result)).length ? null : result;
}
