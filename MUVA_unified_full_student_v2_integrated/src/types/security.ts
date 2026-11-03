/**
 * 实验三安全攻防扩展类型
 * 在不破坏原有任务流程的前提下，添加实时攻击能力
 */

export type AttackType =
  | 'GPS_SPOOFING'      // GPS欺骗：坐标偏移
  | 'COMMAND_INJECTION' // 命令注入：异常指令
  | 'COMM_HIJACK'       // 通信劫持：断连/延迟
  | 'BATTERY_DRAIN'     // 电量攻击：加速耗电
  | 'SENSOR_NOISE';     // 传感器干扰：姿态异常

export type AttackSeverity = 'low' | 'medium' | 'high';

export interface AttackEvent {
  id: string;
  type: AttackType;
  targetDrone: string;
  severity: AttackSeverity;
  startedAt: number;
  endedAt?: number;
  detected: boolean;
  detectedAt?: number;
  mitigated: boolean;
  mitigatedAt?: number;

  // 攻击效果参数
  effect: AttackEffect;
}

export interface AttackEffect {
  // GPS欺骗：坐标偏移量（米）
  positionOffset?: { x: number; y: number; z: number };

  // 命令注入：注入的异常指令
  injectedCommand?: string;

  // 通信劫持：丢包率 (0-1)
  packetLoss?: number;

  // 电量攻击：额外耗电倍率
  batteryDrainMultiplier?: number;

  // 传感器干扰：姿态偏移（度）
  attitudeNoise?: { roll: number; pitch: number; yaw: number };
}

export interface SecurityMetrics {
  totalAttacks: number;
  detectedAttacks: number;
  mitigatedAttacks: number;
  averageDetectionTime: number; // 秒
  affectedDrones: Set<string>;
  taskImpact: 'none' | 'minor' | 'major' | 'critical';
}

export interface DefenseCapability {
  type: DefenseType;
  enabled: boolean;
  effectiveness: number; // 0-1
}

export type DefenseType =
  | 'GPS_VALIDATION'     // GPS异常检测
  | 'COMMAND_WHITELIST'  // 指令白名单
  | 'HEARTBEAT_MONITOR'  // 心跳监控
  | 'ANOMALY_DETECTION'  // 行为异常检测
  | 'REDUNDANCY_CHECK';  // 冗余校验

/**
 * 攻击脚本定义
 */
export interface AttackScript {
  id: string;
  name: string;
  description: string;
  attackType: AttackType;
  severity: AttackSeverity;
  createdAt: number;
  updatedAt: number;
  author: string;
  isBuiltIn: boolean; // 是否为内置脚本

  // 脚本参数配置
  parameters: AttackScriptParameter[];

  // 脚本执行逻辑（JavaScript代码字符串）
  executeCode: string;

  // 标签分类
  tags: string[];

  // 自定义组合按此顺序展示；基础演示模板保留单项结构。
  steps?: AttackScriptStep[];
}

export interface AttackScriptStep {
  id: string;
  attackType: AttackType;
  severity: AttackSeverity;
  parameters: AttackScriptParameter[];
  targetDroneIds: string[];
}

export interface AttackScriptParameter {
  key: string;
  label: string;
  type: 'number' | 'string' | 'boolean' | 'select';
  defaultValue: string | number | boolean;
  options?: Array<{ label: string; value: string | number }>;
  min?: number;
  max?: number;
  description?: string;
}

export interface AttackScriptLibrary {
  scripts: AttackScript[];
  categories: Array<{ name: string; count: number }>;
}
