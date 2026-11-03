import { useLayoutEffect, useRef } from 'react';
import styles from './AircraftIcon.module.css';

/** Independent experiment-three quadrotor silhouette. Rotor motion follows armed state. */
export function AircraftIcon({ size = 28, armed = false }: { size?: number; armed?: boolean }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
    <path d="M10 10 22 22 M22 10 10 22 M13 13 H19 V19 H13 Z" />
    {[[7, 7], [25, 7], [7, 25], [25, 25]].map(([x, y]) => <g key={`${x}-${y}`}><circle cx={x} cy={y} r="4.5" /><g className={armed ? styles.rotating : undefined}><path d={`M${x!-3} ${y}h6 M${x} ${y!-3}v6`} strokeWidth="1" opacity={armed ? '.8' : '.25'}/></g></g>)}
  </svg>;
}

/** Shortest-path yaw avoids 359° → 0° full spins; roll/pitch never shift the map anchor. */
export function AircraftAttitude({ attitude, armed }: { attitude: [number, number, number]; armed: boolean }) {
  const ref=useRef<HTMLSpanElement>(null);
  const heading=useRef(attitude[2]);
  useLayoutEffect(()=>{
    heading.current+=((attitude[2]-heading.current+540)%360+360)%360-180;
    if(ref.current) ref.current.style.transform=`perspective(220px) rotateZ(${heading.current}deg) rotateX(${attitude[1]}deg) rotateY(${attitude[0]}deg)`;
  },[attitude[0],attitude[1],attitude[2]]);
  return <span ref={ref} className={styles.attitude} data-aircraft-attitude><AircraftIcon size={30} armed={armed}/><i className={styles.nose}/></span>;
}
