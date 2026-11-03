import type { ReactElement } from 'react';
import type { AircraftRoute, Position } from '../../../types/collaboration';

const HALO = '#06202d';
const RETURN = '#ffb34d';
const point = (p: Position) => `${p.x},${-p.y}`;
const path = (points: Position[]) => points.map(point).join(' ');

/** Direction chevrons along a polyline. `unit` is metres per screen pixel, so sizes stay constant on screen. */
function arrowsAlong(points: Position[], unit: number, color: string, id: string): ReactElement[] {
  const arrows: ReactElement[] = [];
  points.slice(1).forEach((b, i) => {
    const a = points[i]!;
    const dx = b.x - a.x, dy = b.y - a.y, pixels = Math.hypot(dx, dy) / unit;
    if (pixels < 34) return;
    const count = Math.min(3, Math.max(1, Math.floor(pixels / 150)));
    const angle = Math.atan2(-dy, dx) * 180 / Math.PI;
    for (let k = 0; k < count; k++) {
      const t = (k + .5) / count;
      arrows.push(<polygon key={`${id}-${i}-${k}`} transform={`translate(${a.x + dx * t},${-(a.y + dy * t)}) rotate(${angle})`}
        points={`${7 * unit},0 ${-5 * unit},${-5 * unit} ${-5 * unit},${5 * unit}`} fill={color} stroke={HALO} strokeWidth="1" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />);
    }
  });
  return arrows;
}

interface Props {
  route: AircraftRoute; color: string; selected: boolean; opacity: number;
  /** Metres per screen pixel (1 / (metreScale * zoom)). */
  unit: number; showRoute: boolean; showPoints: boolean;
  /** 0 = no numbers, 1 = every work waypoint, N = every Nth plus the last. */
  labelEvery: number;
}

/**
 * One aircraft's complete planned sortie: Home -> entry -> work route -> return -> Home.
 * Entry and return are drawn as their own dashed legs so the whole loop reads at a glance.
 */
export function PlannedRouteLayer({ route, color, selected, opacity, unit, showRoute, showPoints, labelEvery }: Props) {
  const waypoints = route.waypoints;
  if (waypoints.length < 2) return null;
  const home = waypoints[0]!, work = waypoints.slice(route.workStart), first = work[0]!, last = work.at(-1)!;
  const width = selected ? 4.2 : 3.2;
  const entry = [home, first], back = [last, home];
  return <g data-planned-route={route.droneId} opacity={opacity}>
    {showRoute && <>
      <polyline points={path(entry)} fill="none" stroke={HALO} strokeOpacity=".5" strokeWidth={width + 2.5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <polyline data-route-leg="entry" points={path(entry)} fill="none" stroke={color} strokeWidth={width - 1} strokeDasharray="8 6" strokeLinecap="round" vectorEffect="non-scaling-stroke"><title>{route.droneId} · 入场：Home 起飞至作业起点</title></polyline>
      {arrowsAlong(entry, unit, color, `entry-${route.droneId}`)}
      <polyline points={path(work)} fill="none" stroke={HALO} strokeOpacity=".6" strokeWidth={width + 3} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <polyline data-route-leg="work" points={path(work)} fill="none" stroke={color} strokeWidth={width} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"><title>{route.droneId} · 作业航线 · {route.length.toFixed(0)} m（含入场与返航）</title></polyline>
      {arrowsAlong(work, unit, color, `work-${route.droneId}`)}
      <polyline points={path(back)} fill="none" stroke={HALO} strokeOpacity=".5" strokeWidth={width + 2.5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <polyline data-planned-return={route.droneId} data-route-leg="return" points={path(back)} fill="none" stroke={RETURN} strokeWidth={width - 1} strokeDasharray="8 6" strokeLinecap="round" vectorEffect="non-scaling-stroke"><title>{route.droneId} · 返航：作业终点直飞回 Home 后降落（与模拟返航一致）</title></polyline>
      {arrowsAlong(back, unit, RETURN, `return-${route.droneId}`)}
    </>}
    {showPoints && work.map((p, n) => {
      const numbered = labelEvery > 0 && (n % labelEvery === 0 || n === work.length - 1);
      const end = n === 0 || n === work.length - 1;
      const radius = String(n + 1).length > 2 ? 10.5 : 8;
      return <g key={n} data-generated-waypoint={route.droneId}>
        {numbered ? <>
          <circle cx={p.x} cy={-p.y} r={radius * unit} fill={color} stroke={end ? '#ffffff' : HALO} strokeWidth={end ? 2 : 1.4} vectorEffect="non-scaling-stroke"><title>{route.droneId} 航点 {n + 1}{n === 0 ? '（作业起点）' : n === work.length - 1 ? '（作业终点）' : ''} · E {p.x.toFixed(1)} / N {p.y.toFixed(1)} / H {p.z.toFixed(1)} m</title></circle>
          <text x={p.x} y={-p.y} dy=".35em" fontSize={9.5 * unit} fontWeight="700" textAnchor="middle" fill={HALO} pointerEvents="none">{n + 1}</text>
        </> : <circle cx={p.x} cy={-p.y} r={(selected ? 3.6 : 2.8) * unit} fill={HALO} stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke"><title>{route.droneId} 航点 {n + 1} · E {p.x.toFixed(1)} / N {p.y.toFixed(1)} / H {p.z.toFixed(1)} m</title></circle>}
      </g>;
    })}
  </g>;
}
