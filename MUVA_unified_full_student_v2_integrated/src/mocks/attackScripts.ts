import type { AttackScript } from '../types/security';

const builtIn = (script: Omit<AttackScript, 'createdAt' | 'updatedAt' | 'author' | 'isBuiltIn'>): AttackScript =>
  ({ ...script, createdAt: 0, updatedAt: 0, author: '平台内置', isBuiltIn: true });

/** 内置基础攻击脚本。仅作为教学数据展示，脚本文本不会被执行。 */
export const builtInAttackScripts: AttackScript[] = [
  builtIn({
    id: 'builtin-gps-drift', name: 'GPS 缓慢漂移', description: '以较小幅度持续偏移定位坐标，模拟难以察觉的欺骗。',
    attackType: 'GPS_SPOOFING', severity: 'low', tags: ['定位', '隐蔽'],
    parameters: [
      { key: 'offsetX', label: '东向偏移 (m)', type: 'number', defaultValue: 8, min: -200, max: 200 },
      { key: 'offsetY', label: '北向偏移 (m)', type: 'number', defaultValue: 5, min: -200, max: 200 },
    ],
    executeCode: '// 对目标机位置叠加固定偏移\ndrone.position.x += params.offsetX;\ndrone.position.y += params.offsetY;',
  }),
  builtIn({
    id: 'builtin-gps-jump', name: 'GPS 突变欺骗', description: '一次性大幅偏移定位，触发明显的航迹异常。',
    attackType: 'GPS_SPOOFING', severity: 'high', tags: ['定位', '明显'],
    parameters: [
      { key: 'offsetX', label: '东向偏移 (m)', type: 'number', defaultValue: 60, min: -200, max: 200 },
      { key: 'offsetY', label: '北向偏移 (m)', type: 'number', defaultValue: -40, min: -200, max: 200 },
    ],
    executeCode: '// 对目标机位置一次性叠加大偏移\ndrone.position.x += params.offsetX;\ndrone.position.y += params.offsetY;',
  }),
  builtIn({
    id: 'builtin-cmd-hold', name: '悬停指令注入', description: '向目标机注入伪造的悬停指令，打断航线执行。',
    attackType: 'COMMAND_INJECTION', severity: 'medium', tags: ['指令'],
    parameters: [{ key: 'command', label: '注入指令', type: 'select', defaultValue: 'hold', options: [{ label: '悬停', value: 'hold' }, { label: '返航', value: 'return' }, { label: '降落', value: 'land' }] }],
    executeCode: '// 注入伪造的飞控指令\nsend(drone.id, { type: params.command });',
  }),
  builtIn({
    id: 'builtin-link-loss', name: '链路中断', description: '使目标机的数据链路过期，地面站收不到有效遥测。',
    attackType: 'COMM_HIJACK', severity: 'medium', tags: ['通信'],
    parameters: [{ key: 'packetLoss', label: '丢包率', type: 'number', defaultValue: 0.8, min: 0, max: 1 }],
    executeCode: '// 将连接状态置为过期\ndrone.connectionStatus = "STALE";',
  }),
  builtIn({
    id: 'builtin-battery-drain', name: '电量加速消耗', description: '模拟恶意负载使电量快速下降，迫使任务提前终止。',
    attackType: 'BATTERY_DRAIN', severity: 'medium', tags: ['资源'],
    parameters: [{ key: 'drain', label: '一次性扣减电量 (%)', type: 'number', defaultValue: 20, min: 1, max: 80 }],
    executeCode: '// 扣减电量\ndrone.battery -= params.drain;',
  }),
  builtIn({
    id: 'builtin-imu-noise', name: '姿态传感器干扰', description: '向姿态数据叠加噪声，影响飞行稳定性判断。',
    attackType: 'SENSOR_NOISE', severity: 'low', tags: ['传感器'],
    parameters: [{ key: 'noise', label: '噪声幅度 (°)', type: 'number', defaultValue: 10, min: 1, max: 45 }],
    executeCode: '// 对横滚/俯仰叠加噪声\ndrone.attitude[0] += params.noise;\ndrone.attitude[1] -= params.noise;',
  }),
];
