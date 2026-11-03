/** Teaching-only schematic data. Coordinates are SVG scene units, not GPS or vehicle commands. */
import type { ScenarioId, ScenarioPhase } from '../../../types/securityScenario';
export type { ScenarioId, ScenarioPhase } from '../../../types/securityScenario';
export type Point = [number, number];
export interface ScenarioMetric { label: string; unit: string; values: Record<ScenarioPhase, string> }
export interface SceneMarker { at: Point; label: string; kind: 'normal' | 'threat' | 'success' | 'warning'; phases?: readonly ScenarioPhase[] }
export interface Scenario {
  id: ScenarioId; name: string; task: string; group: string; description: string;
  target: string; nodes: readonly string[]; drones: readonly string[];
  baseline: readonly Point[][]; attacked: readonly Point[][]; protected: readonly Point[][];
  markers: readonly SceneMarker[]; notes: Record<ScenarioPhase, string>;
  metrics: readonly ScenarioMetric[];
}
const all = ['baseline', 'attacked', 'protected'] as const;
export const scenarios: readonly Scenario[] = [
  {
    id: 'patrol', name: '巡逻分区篡改', task: '区域巡逻', group: '第1组',
    description: '篡改第1组分区边界，使两机重复巡逻中部，东侧分区无人覆盖。',
    target: 'UAV-101', nodes: ['RPI-101', 'RPI-102', 'RPI-103'], drones: ['UAV-101', 'UAV-102', 'UAV-103'],
    baseline: [[[88,390],[110,140],[270,140],[260,370]], [[290,380],[300,135],[470,135],[465,370]], [[495,375],[500,130],[690,130],[685,370]]],
    attacked: [[[88,390],[110,140],[270,140],[260,370]], [[290,380],[300,135],[470,135],[465,370]], [[495,375],[310,145],[470,140],[465,370]]],
    protected: [[[88,390],[110,140],[270,140],[260,370]], [[290,380],[300,135],[470,135],[465,370]], [[495,375],[500,130],[690,130],[685,370]]],
    markers: [{ at: [584,255], label: '漏巡：东侧分区', kind: 'threat', phases: ['attacked'] }, { at: [384,220], label: '重复巡逻', kind: 'warning', phases: ['attacked'] }, { at: [585,255], label: '分区恢复覆盖', kind: 'success', phases: ['protected'] }],
    notes: { baseline: '三机各自覆盖一个分区，航线互不重叠。', attacked: '分区配置被改写：UAV-103 转入中区，东区漏巡。', protected: '分区校验拒绝篡改，三机恢复原覆盖。' },
    metrics: [{ label: '巡逻覆盖率', unit: '%', values: { baseline: '96', attacked: '67', protected: '96' } }, { label: '漏巡面积', unit: 'km²', values: { baseline: '0.1', attacked: '2.4', protected: '0.1' } }],
  },
  {
    id: 'search', name: '虚假目标注入', task: '目标搜索', group: '第2组',
    description: '向目标识别结果中注入假坐标，诱导搜索机偏离真实目标并进行无效复核。',
    target: 'UAV-202', nodes: ['RPI-201', 'RPI-202', 'RPI-203'], drones: ['UAV-201', 'UAV-202', 'UAV-203'],
    baseline: [[[90,330],[220,115],[360,200],[445,110]], [[92,370],[240,320],[420,310],[570,230]], [[90,410],[270,410],[510,390],[690,330]]],
    attacked: [[[90,330],[220,115],[360,200],[445,110]], [[92,370],[240,320],[545,110],[675,105]], [[90,410],[270,410],[510,390],[690,330]]],
    protected: [[[90,330],[220,115],[360,200],[445,110]], [[92,370],[240,320],[420,310],[570,230]], [[90,410],[270,410],[510,390],[690,330]]],
    markers: [{ at: [563,235], label: '真实目标', kind: 'normal', phases: all }, { at: [669,105], label: '假目标 · 误导转向', kind: 'threat', phases: ['attacked'] }, { at: [669,105], label: '假目标已过滤', kind: 'success', phases: ['protected'] }],
    notes: { baseline: '三机按搜索扇区复核，真实目标被发现。', attacked: 'UAV-202 被假目标吸引，真实目标暂未确认。', protected: '多源复核过滤假目标，恢复真实目标搜索。' },
    metrics: [{ label: '真实目标发现', unit: '个', values: { baseline: '1', attacked: '0', protected: '1' } }, { label: '无效复核耗时', unit: '分钟', values: { baseline: '0', attacked: '8', protected: '0' } }],
  },
  {
    id: 'monitor', name: '监测数据冻结', task: '定点监测', group: '第3组',
    description: '冻结一架无人机的回传数据；现场状态仍变化，控制台却持续显示旧值。',
    target: 'UAV-302', nodes: ['RPI-301', 'RPI-302', 'RPI-303'], drones: ['UAV-301', 'UAV-302', 'UAV-303'],
    baseline: [[[105,390],[180,160],[220,180]], [[95,395],[370,125],[400,200]], [[100,390],[590,145],[630,180]]],
    attacked: [[[105,390],[180,160],[220,180]], [[95,395],[370,125],[400,200]], [[100,390],[590,145],[630,180]]],
    protected: [[[105,390],[180,160],[220,180]], [[95,395],[370,125],[400,200]], [[100,390],[590,145],[630,180]]],
    markers: [{ at: [220,180], label: '监测点 A', kind: 'normal', phases: all }, { at: [630,180], label: '监测点 C', kind: 'normal', phases: all }, { at: [400,200], label: '现场告警 / 回传正常', kind: 'threat', phases: ['attacked'] }, { at: [400,200], label: '现场变化已检出', kind: 'success', phases: ['protected'] }, { at: [400,200], label: '监测点 B', kind: 'normal', phases: ['baseline'] }],
    notes: { baseline: '监测点 B 出现事件，新鲜回传能及时检出。', attacked: '现场事件仍在发生；UAV-302 回传冻结 12 分钟，事件漏报。', protected: '时间戳校验识别陈旧数据，并请求实时回传完成检出。' },
    metrics: [{ label: '事件检出', unit: '个', values: { baseline: '1', attacked: '0', protected: '1' } }, { label: '回传数据年龄', unit: '分钟', values: { baseline: '<1', attacked: '12', protected: '<1' } }],
  },
  {
    id: 'delivery', name: '交付点替换', task: '物资运输', group: '第4组',
    description: '替换任务交付坐标，将 UAV-402 的终点从 B 误导至 B′，造成物资误投风险。',
    target: 'UAV-402', nodes: ['RPI-401', 'RPI-402', 'RPI-403'], drones: ['UAV-401', 'UAV-402', 'UAV-403'],
    baseline: [[[95,360],[255,295],[570,250]], [[95,385],[290,315],[565,275]], [[95,410],[275,355],[555,300]]],
    attacked: [[[95,360],[255,295],[570,250]], [[95,385],[290,315],[665,105]], [[95,410],[275,355],[555,300]]],
    protected: [[[95,360],[255,295],[570,250]], [[95,385],[290,315],[565,275]], [[95,410],[275,355],[555,300]]],
    markers: [{ at: [100,385], label: '装载点 A', kind: 'normal', phases: all }, { at: [585,285], label: '原交付点 B', kind: 'normal', phases: all }, { at: [662,100], label: '错误交付点 B′ · 误投风险', kind: 'threat', phases: ['attacked'] }, { at: [662,100], label: 'B′ 已拦截', kind: 'success', phases: ['protected'] }],
    notes: { baseline: '三机沿正常航线驶向交付点 B，预计全部正确交付。', attacked: 'UAV-402 改飞 B′；尚未实际投递，预计正确交付减少。', protected: '交付点签名不匹配，拦截 B′ 并恢复 B 航线。' },
    metrics: [{ label: '预计正确交付', unit: '架', values: { baseline: '3', attacked: '2', protected: '3' } }, { label: '最大交付点偏差', unit: '米', values: { baseline: '0', attacked: '420', protected: '0' } }],
  },
  {
    id: 'rescue', name: '救援优先级欺骗', task: '应急救援', group: '第5组',
    description: '注入高优先级虚假请求，使一架救援机离开真实救援点，挤占响应资源。',
    target: 'UAV-503', nodes: ['RPI-501', 'RPI-502', 'RPI-503'], drones: ['UAV-501', 'UAV-502', 'UAV-503'],
    baseline: [[[105,380],[250,195],[325,155]], [[105,390],[340,300],[485,225]], [[105,405],[420,385],[615,310]]],
    attacked: [[[105,380],[250,195],[325,155]], [[105,390],[340,300],[485,225]], [[105,405],[420,385],[665,115]]],
    protected: [[[105,380],[250,195],[325,155]], [[105,390],[340,300],[485,225]], [[105,405],[420,385],[615,310]]],
    markers: [{ at: [325,155], label: '真实救援点 1', kind: 'normal', phases: all }, { at: [485,225], label: '真实救援点 2', kind: 'normal', phases: all }, { at: [615,310], label: '真实救援点 3', kind: 'normal', phases: all }, { at: [665,115], label: '虚假高优先级请求', kind: 'threat', phases: ['attacked'] }, { at: [665,115], label: '虚假请求被拒绝', kind: 'success', phases: ['protected'] }, { at: [605,350], label: '真实救援延误', kind: 'warning', phases: ['attacked'] }],
    notes: { baseline: '三个真实请求按时响应。', attacked: 'UAV-503 被虚假请求抢占，真实救援点 3 预计延误。', protected: '请求身份复核拒绝伪造优先级，恢复真实救援调度。' },
    metrics: [{ label: '预计按时完成', unit: '项', values: { baseline: '3', attacked: '2', protected: '3' } }, { label: '真实任务预计延误', unit: '分钟', values: { baseline: '0', attacked: '9', protected: '0' } }],
  },
];
