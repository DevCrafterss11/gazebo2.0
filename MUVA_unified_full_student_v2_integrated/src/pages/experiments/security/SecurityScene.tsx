import type { Point, Scenario, ScenarioPhase } from './scenarios';
import styles from './SecurityExperimentPage.module.css';
const path = (points: readonly Point[]) => points.map(([x, y]) => `${x},${y}`).join(' ');
/** Teaching schematic: not geographic coordinates or live telemetry. */
export function SecurityScene({ scenario, phase }: { scenario: Scenario; phase: ScenarioPhase }) {
  return <div className={styles.scene} role="img" aria-label={`${scenario.name}：${scenario.notes[phase]}。虚线为正常任务，实线为当前演示航迹`}>
    <svg viewBox="0 0 780 480" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs><pattern id="securityGrid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1b4869" strokeWidth=".8" /></pattern></defs>
      <rect width="780" height="480" fill="#061b30" /><rect width="780" height="480" fill="url(#securityGrid)" />
      <path d="M 55 70 H 730 M 55 430 H 730" stroke="#244760" strokeWidth="1" />
      <text x="55" y="54" className={styles.mapCaption}>MISSION SIMULATION / 三机协同示意</text>
      {scenario.id === 'patrol' && <g className={styles.zones}>
        <rect x="85" y="105" width="205" height="295" /><rect x="295" y="105" width="205" height="295" /><rect x="505" y="105" width="205" height="295" />
        <text x="100" y="125">A 区</text><text x="310" y="125">B 区</text><text x="520" y="125">C 区</text>
        {phase === 'attacked' && <rect x="505" y="105" width="205" height="295" className={styles.missedZone} />}
      </g>}
      {scenario.id === 'monitor' && <g className={styles.monitorHalo}><circle cx="220" cy="180" r="62"/><circle cx="400" cy="200" r="62"/><circle cx="630" cy="180" r="62"/></g>}
      {scenario.baseline.map((points, index) => <polyline key={`base-${index}`} points={path(points)} className={styles.referenceRoute} />)}
      {scenario[phase].map((points, index) => <g key={`actual-${index}`}>
        <polyline points={path(points)} className={`${styles.actualRoute} ${phase === 'attacked' && path(points) !== path(scenario.baseline[index]!) ? styles.deviatedRoute : ''}`} />
        <circle cx={points.at(-1)![0]} cy={points.at(-1)![1]} r="6" className={phase === 'attacked' && path(points) !== path(scenario.baseline[index]!) ? styles.attackedDrone : styles.drone} />
        <text x={points.at(-1)![0]} y={points.at(-1)![1] - 16} textAnchor="middle" className={styles.droneLabel}>{scenario.drones[index]}</text>
      </g>)}
      {scenario.markers.filter(marker => !marker.phases || marker.phases.includes(phase)).map(marker => <g key={marker.label} className={styles[marker.kind]}>
        <circle cx={marker.at[0]} cy={marker.at[1]} r="11" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx={marker.at[0]} cy={marker.at[1]} r="3" fill="currentColor" />
        <text x={marker.at[0] > 520 ? marker.at[0] - 17 : marker.at[0] + 17} y={marker.at[1] + 26} textAnchor={marker.at[0] > 520 ? 'end' : 'start'} className={styles.markerText}>{marker.label}</text>
      </g>)}
      {scenario.id === 'monitor' && <g className={phase === 'attacked' ? styles.threat : styles.success}><rect x="282" y="286" width="224" height="72" rx="6" fill="#09243d" stroke="currentColor"/><text x="298" y="313" className={styles.readout}>{phase === 'attacked' ? '现场：告警 / 回传：正常' : '现场：告警 / 回传：告警'}</text><text x="298" y="340" className={styles.readout}>数据年龄：{phase === 'attacked' ? '12 分钟 · 陈旧' : '< 1 分钟 · 新鲜'}</text></g>}
    </svg>
    <div className={styles.legend}><span><i className={styles.dash} />正常任务参考</span><span><i className={styles.solid} />当前执行</span><span><i className={styles.redDot} />受攻击目标 / 影响</span></div>
  </div>;
}
