import { attackedTrajectorySegments } from '../../../domain/collaborationGps';
import type { Drone } from '../../../types/collaboration';

export function GpsAttackTrace({ drone, selected }: { drone: Drone; selected: boolean }) {
  return <g data-gps-actual-trace={drone.id} aria-label={`${drone.id} GPS攻击期间实际轨迹`}>
    {attackedTrajectorySegments(drone.trajectory).map((segment, i) => <polyline key={i}
      points={segment.map(p => `${p.x},${-p.y}`).join(' ')} fill="none" stroke="#ff4545"
      strokeWidth={selected ? 5 : 4} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />)}
  </g>;
}
export function GpsMapLayer({ drones, scale, selectedId }: { drones: Drone[]; scale: number; selectedId?: string | null }) {
  return <g pointerEvents="none" aria-label="GPS欺骗定位偏差">
    {drones.filter(d => d.gpsAttack?.phase === 'active' && d.reportedPosition).map(d => {
      const p = d.reportedPosition!, offset = d.gpsAttack!.offset;
      return <g key={d.id} data-gps-marker={d.id} opacity={selectedId === d.id ? 1 : .7}>
        <line x1={d.position.x} y1={-d.position.y} x2={p.x} y2={-p.y} stroke="#ffb347" strokeWidth="2" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
        <circle cx={p.x} cy={-p.y} r={8 / scale} fill="none" stroke="#ffb347" strokeWidth="2.5" vectorEffect="non-scaling-stroke"><title>{d.id} 被欺骗的 GPS 定位 · 水平偏移 {Math.hypot(offset.x, offset.y).toFixed(1)} m</title></circle>
        {selectedId === d.id && <text x={p.x + 11 / scale} y={-p.y - 11 / scale} fontSize={11 / scale} fill="#ffd79b" stroke="#102631" strokeWidth={3 / scale} paintOrder="stroke">
          {d.id} GPS · Δ平面 {Math.hypot(offset.x, offset.y).toFixed(1)} m · Δ高 {offset.z.toFixed(1)} m
        </text>}
      </g>;
    })}
  </g>;
}
