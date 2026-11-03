import { useId } from 'react';
import type { Drone } from '../../../types/collaboration';
import styles from './TelemetryAttitude.module.css';

/** Instrument projection only: values and aircraft orientation share the runtime's R/P/Y. */
export function TelemetryAttitude({ droneId, attitude, armed, streaming }: { droneId: string; attitude: Drone['attitude']; armed: boolean; streaming: boolean }) {
  const clip = useId();
  const [roll, pitch, yaw] = attitude;
  return <section className={styles.instrument} aria-label={`${droneId} 实时姿态`} data-attitude-instrument={droneId} data-roll={roll} data-pitch={pitch} data-yaw={yaw}>
    <svg className={styles.horizon} viewBox="0 0 64 64" role="img" aria-label={`人工地平仪：横滚 ${roll.toFixed(1)} 度，俯仰 ${pitch.toFixed(1)} 度`}>
      <defs><clipPath id={clip}><circle cx="32" cy="32" r="28" /></clipPath></defs>
      <g clipPath={`url(#${clip})`}>
        <g className={styles.scene} style={{ transform: `rotate(${-roll}deg) translateY(${Math.max(-30, Math.min(30, pitch)) * 1.2}px)` }}>
          <path fill="#28677d" d="M-64-64H128V32H-64Z" /><path fill="#5c4c3e" d="M-64 32H128V128H-64Z" />
          <path d="M-64 32H128" stroke="#dceaf0" strokeWidth="1.4" />
          <path d="M24 20H40M28 26H36M28 38H36M24 44H40" stroke="#dceaf0" opacity=".65" />
        </g>
      </g>
      <circle cx="32" cy="32" r="28" fill="none" stroke="#53828f" />
      <path d="M8 32H23L26 35M56 32H41L38 35M32 29V35" fill="none" stroke="#ffe19a" strokeWidth="2" strokeLinecap="round" />
      <path d="M29 3L32 7L35 3" fill="none" stroke="#b9dce5" strokeWidth="1.5" />
    </svg>
    <dl className={styles.values}>
      <div><dt>横滚 R</dt><dd data-attitude-value="roll">{roll.toFixed(1)}<small>°</small></dd></div>
      <div><dt>俯仰 P</dt><dd data-attitude-value="pitch">{pitch.toFixed(1)}<small>°</small></dd></div>
      <div><dt>航向 Y</dt><dd data-attitude-value="yaw">{yaw.toFixed(1)}<small>°</small></dd></div>
    </dl>
    <span className={styles.caption}>{!streaming ? '遥测暂停 · 保留姿态' : armed ? '姿态随遥测更新' : '地面姿态 · 稳定'}</span>
  </section>;
}
