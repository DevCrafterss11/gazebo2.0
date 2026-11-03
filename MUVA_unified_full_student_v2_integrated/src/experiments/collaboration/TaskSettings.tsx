import type { TaskConfig, TaskGroup } from '../../types/collaboration';
import styles from './Collaboration.module.css';

const labels = ['区域巡逻', '目标搜索', '定点监测', '物资运输', '应急救援'];
export function TaskSettings({ group, index, onChange, disabled = false }: { group: TaskGroup; index: number; onChange: (patch: Partial<TaskConfig>) => void; disabled?: boolean }) {
  const config = group.config;
  const numeric = (key: keyof TaskConfig, title: string, min = 1, max = 120) => <label key={key}>{title}<input type="number" aria-label={title} disabled={disabled} min={min} max={max} value={typeof config[key] === 'number' ? config[key] : ''} onChange={e => { if (e.target.value === '' && (key === 'targetEast' || key === 'targetNorth')) onChange({ [key]: undefined }); else if (Number.isFinite(e.target.valueAsNumber)) onChange({ [key]: e.target.valueAsNumber }); }} /></label>;
  const choice = (key: keyof TaskConfig, title: string, options: string[]) => <label key={key}>{title}<select aria-label={title} disabled={disabled} value={String(config[key])} onChange={e => onChange({ [key]: e.target.value })}>{options.map(option => <option key={option}>{option}</option>)}</select></label>;
  return <div className={styles.taskSettings}><div className={styles.configSeparator}>{labels[index]} · 专属参数</div>
    {numeric('altitude', index === 2 ? '监测高度（m）' : '飞行高度（m）', 5)}
    {index < 2 && <>{numeric('routeSpacing', '扫描航线间距（m）')}<label>扫描方向<select aria-label="扫描方向" disabled={disabled} value={config.headingMode ?? 'manual'} onChange={e => onChange({ headingMode: e.target.value === 'auto' ? 'auto' : 'manual' })}><option value="auto">自动 · 最小外接矩形长边</option><option value="manual">手动指定航向</option></select></label>{config.headingMode !== 'auto' && numeric('heading', '扫描航向角（°）', 0, 359)}<small>按执行扫描的飞机数量等面积分区，逐机生成区内蛇形航点；航线严格裁剪到各自分区，复杂凹区无法连续规划时会提示调整。</small></>}
    {index === 0 && <>{numeric('coverage', '覆盖航段验收要求（%）', 1, 100)}{choice('strategy', '巡逻方式', ['区域覆盖', '顺时针巡逻', '分区巡逻'])}</>}
    {index === 1 && <>{numeric('searchRange', '单点搜索半径（m）', 10, 500)}{choice('strategy', '搜索方式', ['网格搜索', '协同搜索'])}{choice('confirmation', '目标确认条件', ['双机确认', '单机确认', '人工复核'])}{numeric('targetEast', '演练目标东向 E（m）', -20000, 20000)}{numeric('targetNorth', '演练目标北向 N（m）', -20000, 20000)}<small>目标 E / N 坐标须同时填写或同时留空；也可使用地图拾取。留空时规划器会生成并明确展示演练目标。探测仅按模拟位置和距离判定，不使用摄像头。单点搜索可直接添加一个中心点；区域搜索需闭合多边形。中继点在生成航线时自动规划，中继机不扫描、不参与目标确认。</small></>}
    {index === 2 && <>{numeric('duration', '每架到点驻留时间（s）')}{choice('strategy', '轮换策略', ['轮换监测', '持续驻留'])}{choice('handover', '交接方式', ['重叠监测', '到点交接'])}<small>重叠监测：下一架提前起飞，到点交接后上一架返航。到点交接：上一架完成驻留后下一架起飞，记录监测空窗。队列每架执行一次，返航后不会自动补电循环。</small></>}
    {index === 3 && <>{choice('cargo', '模拟物资信息', ['急救物资 2 kg', '药品 1 kg', '饮水 3 kg'])}{choice('strategy', '运输航线', ['定点交付', '途经航点运输'])}{choice('confirmation', '模拟交付确认', ['到点确认', '人工签收'])}<small>按各机 Home → 装载点 → 途经航点 → 交付点飞行，再返回各自 Home。不模拟真实载荷投放、称重或地形避障。</small></>}
    {index === 4 && <>{choice('priority', '响应优先级', ['高', '普通', '紧急'])}{choice('strategy', '救援策略', ['优先响应', '先侦察后救援', '并行救援'])}{numeric('duration', '现场模拟驻留时间（s）')}<small>先侦察后救援需要侦察机角色；侦察到点并经人工确认后，救援队列才起飞。中继机若参与，将提前到响应点与事件点之间驻留，不替代侦察或救援；最终结果也需要人工模拟验收。不模拟真实通信转发。</small></>}
  </div>;
}
