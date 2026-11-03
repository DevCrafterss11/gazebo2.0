import type { Position } from '../../../types/collaboration';

/** Experiment 3's offline 2D training grounds, in the fleet's metre coordinates.
 * Vector ground features move and scale with waypoints, aircraft and flight tracks.
 * No remote imagery, experiment-2 state or geographic claims are involved. */
export function SimulationTerrain({ grid, homes, variant = 'training' }: { grid: boolean; homes: Position[]; variant?: 'training' | 'field' }) {
  if (variant === 'field') return <svg viewBox="-100 -70 200 140" preserveAspectRatio="none" aria-label="二维运动场模拟底图" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
    <defs><pattern id="live-field-grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" fill="none" stroke="#245e65" strokeOpacity=".25" strokeWidth=".15" /></pattern></defs>
    <rect x="-600" y="-420" width="1200" height="840" fill="#c6e3e9" />
    <path d="M-220-160H170V175H-220Z" fill="#b8d9bd" />
    <g transform="rotate(-18) scale(.55)">
      <rect x="-127" y="-146" width="254" height="292" rx="100" fill="#dbb7a2" />
      {[0,1,2,3].map(i => <rect key={i} x={-123+i*4} y={-142+i*4} width={246-i*8} height={284-i*8} rx={96-i*4} fill="none" stroke="#f8e7d7" strokeWidth=".35" />)}
      <rect x="-104" y="-122" width="208" height="244" rx="80" fill="#8ed4bf" />
      <g fill="none" stroke="#e2f5e4" strokeWidth=".4"><rect x="-78" y="-101" width="156" height="202" /><path d="M-78 0H78M-33-101V-72H33V-101M-33 101V72H33V101M-15-101V-90H15V-101M-15 101V90H15V101" /><circle r="21" /><circle cy="-79" r=".8" /><circle cy="79" r=".8" /></g>
    </g>
    <path d="M150-200Q85-65 126 7T90 180" fill="none" stroke="#d9ece9" strokeWidth="15" />
    <path d="M150-200Q85-65 126 7T90 180" fill="none" stroke="#8faea9" strokeWidth=".5" />
    {grid && <rect x="-600" y="-420" width="1200" height="840" fill="url(#live-field-grid)" />}
    <g fill="#2b6e67" fontSize="2.2"><text x="58" y="-45">演训场</text><text x="-70" y="62">本地模拟场景 · 米</text></g>
    <path d="M-88-47V-59L-91-54M-88-59-85-54" fill="none" stroke="#2b6e67" strokeWidth=".6" /><text x="-90" y="-62" fontSize="3" fill="#2b6e67">N</text>
  </svg>;
  return <svg viewBox="-100 -70 200 140" preserveAspectRatio="none" aria-label="实验三二维演训场底图" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
    <defs><pattern id="collaboration-ground" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#173c3e" /><path d="M0 8 8 0M-4 4 4-4M4 12 12 4" stroke="#214749" strokeWidth=".16" /></pattern></defs>
    <rect x="-600" y="-420" width="1200" height="840" fill="url(#collaboration-ground)" />
    <path d="M-140-82-47-86-62-25-125-14ZM20-94 96-90 82-38 33-45ZM54 24 130 9 132 94 34 86Z" fill="#1f4940" stroke="#315f52" strokeWidth=".3" />
    <path d="M87-100Q49-50 77-20T62 45T93 100" fill="none" stroke="#123a50" strokeWidth="13" />
    <path d="M87-100Q49-50 77-20T62 45T93 100" fill="none" stroke="#315668" strokeWidth=".45" strokeDasharray="2 3" />
    <path d="M-120 43 120 43M-55-100-55 100M-55-38 48-38M38-38 38 43" fill="none" stroke="#466164" strokeWidth="5" />
    <path d="M-120 43 120 43M-55-100-55 100M-55-38 48-38M38-38 38 43" fill="none" stroke="#9caa9c" opacity=".5" strokeWidth=".2" strokeDasharray="2 2" />
    <rect x="-55" y="-36" width="110" height="72" rx="2" fill="#28474c" stroke="#597377" strokeWidth=".35" />
    <rect x="-53" y="-34" width="106" height="68" rx="1" fill="none" stroke="#5a7c7c" strokeWidth=".2" strokeDasharray="2 2" />
    {homes.map((p, i) => <circle key={i} cx={p.x} cy={-p.y} r="3.3" fill="none" stroke="#668e85" strokeWidth=".25" />)}
    {[[-89, -25, 21, 9], [-89, -11, 21, 12], [-88, 9, 12, 21], [-72, 14, 9, 16], [-40, -59, 18, 12], [-17, -59, 28, 12], [12, 32, 18, 7], [-34, 52, 20, 12], [-9, 52, 15, 16]].map(([x, y, w, h], i) => <g key={i}><rect x={x} y={y} width={w} height={h} rx=".6" fill="#38595e" stroke="#728887" strokeWidth=".35" /><path d={`M${x! + 2} ${y! + 2}h${w! - 4}`} stroke="#6e8b8e" strokeWidth=".5" /></g>)}
    <g fill="#9cbcb4" fontSize="2.1" letterSpacing=".3"><text x="-28" y="40">无人机起降区 / HOME</text><text x="-89" y="-30">通信与保障站</text><text x="-31" y="-63">任务演训场 A</text><text x="-34" y="73">物资交付区</text><text x="81" y="-36" transform="rotate(16 81 -36)">模拟水域</text><text x="-109" y="-49">巡逻演训区</text><text x="42" y="63">应急响应区</text></g>
    {grid && <><defs><pattern id="collaboration-grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" fill="none" stroke="#86c7c0" strokeOpacity=".2" strokeWidth=".2" /></pattern></defs><rect x="-600" y="-420" width="1200" height="840" fill="url(#collaboration-grid)" /></>}
    <path d="M-99-57-99-66-101-62M-99-66-97-62" fill="none" stroke="#a1c8c0" strokeWidth=".4" /><text x="-100" y="-68" fontSize="2.8" fill="#a1c8c0">N</text>
  </svg>;
}
