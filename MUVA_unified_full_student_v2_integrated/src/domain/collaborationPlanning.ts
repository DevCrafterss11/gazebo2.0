import type { AircraftRoute, CoverageRegion, Mission, MissionPlan, Position, TaskGroup, TaskExecution } from '../types/collaboration';

const eps = 1e-7;
export const distance3 = (a: Position, b: Position) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const pathLength = (points: Position[]) => points.slice(1).reduce((sum, p, i) => sum + distance3(p, points[i]!), 0);
export const polygonArea = (p: Position[]) => Math.abs(p.reduce((sum, a, i) => { const b = p[(i + 1) % p.length]!; return sum + a.x * b.y - b.x * a.y; }, 0)) / 2;
const cross = (a: Position, b: Position, c: Position) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const onSegment = (a: Position, b: Position, p: Position) => Math.abs(cross(a, b, p)) < eps && p.x >= Math.min(a.x, b.x) - eps && p.x <= Math.max(a.x, b.x) + eps && p.y >= Math.min(a.y, b.y) - eps && p.y <= Math.max(a.y, b.y) + eps;
export function validPlanningPolygon(p: Position[]): boolean {
  if (p.length < 3 || p.length > 100 || p.some(a => !Number.isFinite(a.x) || !Number.isFinite(a.y)) || polygonArea(p) < 1) return false;
  if (p.some((a, i) => p.some((b, j) => i !== j && Math.hypot(a.x - b.x, a.y - b.y) < .01))) return false;
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
    if (j === i + 1 || i === 0 && j === p.length - 1) continue;
    const a = p[i]!, b = p[(i + 1) % p.length]!, c = p[j]!, d = p[(j + 1) % p.length]!;
    if (onSegment(a,b,c) || onSegment(a,b,d) || onSegment(c,d,a) || onSegment(c,d,b) || cross(a,b,c) * cross(a,b,d) < 0 && cross(c,d,a) * cross(c,d,b) < 0) return false;
  }
  return true;
}
export function insidePolygon(p: Position, polygon: Position[]): boolean {
  let inside = false;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!;
    if (onSegment(a,b,p)) return true;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) inside = !inside;
  }
  return inside;
}
/** Test every interval cut by polygon edges, not just the segment midpoint. */
export function segmentInside(a: Position, b: Position, polygon: Position[]): boolean {
  const dx = b.x-a.x, dy = b.y-a.y;
  const cuts = [0,1];
  for (let i=0;i<polygon.length;i++) {
    const c=polygon[i]!, d=polygon[(i+1)%polygon.length]!, ex=d.x-c.x, ey=d.y-c.y;
    const denominator=dx*ey-dy*ex;
    if (Math.abs(denominator)<eps) continue;
    const t=((c.x-a.x)*ey-(c.y-a.y)*ex)/denominator, u=((c.x-a.x)*dy-(c.y-a.y)*dx)/denominator;
    if(t>0&&t<1&&u>=0&&u<=1) cuts.push(t);
  }
  cuts.sort((x,y)=>x-y);
  return insidePolygon(a,polygon) && insidePolygon(b,polygon) && cuts.slice(1).every((t,i)=> {
    const f=(t+cuts[i]!)/2; return insidePolygon({x:a.x+f*dx,y:a.y+f*dy,z:a.z},polygon);
  });
}
/** Visibility graph keeps transfers between scan spans inside concave polygons. */
function connectInside(a: Position,b: Position,polygon: Position[]): Position[] {
  if(segmentInside(a,b,polygon)) return [b];
  const nodes=[a,b,...polygon], cost=nodes.map(()=>Infinity), previous=nodes.map(()=>-1), visited=new Set<number>(); cost[0]=0;
  for(let k=0;k<nodes.length;k++) {
    let at=-1;
    for(let i=0;i<nodes.length;i++) if(!visited.has(i)&&(at<0||cost[i]!<cost[at]!)) at=i;
    if(at<0||!Number.isFinite(cost[at]!)) break;
    if(at===1) break;
    visited.add(at);
    for(let j=0;j<nodes.length;j++) if(!visited.has(j)&&segmentInside(nodes[at]!,nodes[j]!,polygon)) {
      const next=cost[at]!+distance3(nodes[at]!,nodes[j]!);
      if(next<cost[j]!) {cost[j]=next;previous[j]=at;}
    }
  }
  if(!Number.isFinite(cost[1]!)) throw new Error('凹区域转场无法连接，请调整区域边界');
  const route: Position[]=[]; let at=1;
  while(at!==0) {route.unshift(nodes[at]!);at=previous[at]!;if(at<0) throw new Error('区域连接失败');}
  return route;
}
const rotate = (p: Position, angle: number): Position => ({x:p.x*Math.cos(angle)-p.y*Math.sin(angle),y:p.x*Math.sin(angle)+p.y*Math.cos(angle),z:p.z});
/** Independent ENU implementation of experiment two's minimum bounding rectangle idea.
 * Only chooses scan direction; coverage still clips to the actual user boundary.
 */
export function automaticCoverageHeading(polygon: Position[]): number {
  if (!validPlanningPolygon(polygon)) throw new Error('请先绘制有效闭合区域');
  const sorted = [...polygon].sort((a, b) => a.x - b.x || a.y - b.y);
  const half = (points: Position[]) => { const result: Position[] = []; for (const point of points) { while (result.length > 1 && cross(result[result.length - 2]!, result[result.length - 1]!, point) <= 0) result.pop(); result.push(point); } return result; };
  const hull = [...half(sorted).slice(0, -1), ...half([...sorted].reverse()).slice(0, -1)];
  let area = Infinity, heading = 0;
  hull.forEach((a, i) => {
    const b = hull[(i + 1) % hull.length]!, angle = Math.atan2(b.y - a.y, b.x - a.x);
    const aligned = hull.map(p => rotate(p, -angle));
    const width = Math.max(...aligned.map(p => p.x)) - Math.min(...aligned.map(p => p.x));
    const height = Math.max(...aligned.map(p => p.y)) - Math.min(...aligned.map(p => p.y));
    const candidate = ((angle + (height > width ? Math.PI / 2 : 0)) * 180 / Math.PI % 180 + 180) % 180;
    if (width * height < area - eps || Math.abs(width * height - area) <= eps && candidate < heading) { area = width * height; heading = candidate; }
  });
  return heading;
}

/** Metric scanline clipping; every scan span respects the user-drawn boundary. */
export function coverageRoutes(polygon: Position[], spacing: number, count: number, heading=0, minRows=count): Position[][] {
  if(!validPlanningPolygon(polygon)) throw new Error('请闭合有效区域：不能交叉、重合或共线');
  if(!Number.isFinite(spacing)||spacing<1||count<1) throw new Error('航线间距或参与数量无效');
  const angle=heading*Math.PI/180, aligned=polygon.map(p=>rotate(p,-angle));
  const min=Math.min(...aligned.map(p=>p.y)),max=Math.max(...aligned.map(p=>p.y));
  // Clipped band edges carry ~1e-12 noise; without a tolerance an exact multiple of spacing flips a row.
  const rows=Math.max(count,minRows,Math.ceil((max-min)/spacing-1e-6));
  if(rows>500) throw new Error('航线超过 500 个扫描行，请增大间距或缩小区域');
  const lanes: Position[][]=[];
  for(let row=0;row<rows;row++) {
    const y=min+(row+.5)*(max-min)/rows, xs: number[]=[];
    aligned.forEach((a,i)=>{const b=aligned[(i+1)%aligned.length]!;if((a.y>y)!==(b.y>y)) xs.push(a.x+(y-a.y)*(b.x-a.x)/(b.y-a.y));});
    xs.sort((a,b)=>a-b);
    const points: Position[]=[];
    for(let i=0;i+1<xs.length;i+=2) if(xs[i+1]!-xs[i]!>eps) points.push({x:xs[i]!,y,z:polygon[0]!.z},{x:xs[i+1]!,y,z:polygon[0]!.z});
    if(row%2) points.reverse();
    if(points.length) lanes.push(points.map(p=>rotate(p,angle)));
  }
  if(lanes.length<count) throw new Error('区域过窄，无法为每架飞机分配有效覆盖航段，请减少参与数量');
  return Array.from({length:count},(_,index)=>{
    const segments=lanes.slice(Math.floor(index*lanes.length/count),Math.floor((index+1)*lanes.length/count));
    const route: Position[]=[];
    for(const lane of segments) for(const p of lane) route.push(...(route.length?connectInside(route.at(-1)!,p,polygon):[p]));
    return route;
  });
}
/** Experiment-3 ENU copy of experiment two's equal-area, rotated-band partition.
 * Boundaries are found by polygon clipping (not by splitting the bounding box or
 * assigning equal numbers of scan rows). Each generated route is clipped to its
 * own region; changing the member count regenerates all regions and waypoints.
 */
function clipNorth(polygon: Position[], limit: number, keepAbove: boolean): Position[] {
  const inside = (p: Position) => keepAbove ? p.y >= limit - eps : p.y <= limit + eps;
  const result: Position[] = [];
  polygon.forEach((current, i) => {
    const previous = polygon[(i + polygon.length - 1) % polygon.length]!;
    if (inside(previous) !== inside(current)) {
      const fraction = (limit - previous.y) / (current.y - previous.y);
      result.push({ x: previous.x + fraction * (current.x - previous.x), y: limit, z: current.z });
    }
    if (inside(current)) result.push(current);
  });
  return result.filter((p, i) => Math.hypot(p.x - result[(i + result.length - 1) % result.length]!.x, p.y - result[(i + result.length - 1) % result.length]!.y) > .001);
}
const planar = (a: Position, b: Position) => Math.hypot(a.x - b.x, a.y - b.y);
/** Minimum-total-transit assignment of routes to aircraft homes (bitmask DP, n <= 15). Each route may be entered from either end. */
function assignRoutesToHomes(routes: Position[][], homes: Position[]): { order: number[]; reversed: boolean[] } {
  const n = routes.length, full = (1 << n) - 1;
  const entry = (d: number, r: number) => {
    const first = planar(homes[d]!, routes[r]![0]!), last = planar(homes[d]!, routes[r]!.at(-1)!);
    return { cost: Math.min(first, last), reversed: last < first - 1e-9 };
  };
  const best: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(full + 1).fill(Infinity));
  const choice: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(full + 1).fill(-1));
  best[0]![0] = 0;
  for (let d = 0; d < n; d++) for (let mask = 0; mask <= full; mask++) {
    const base = best[d]![mask]!;
    if (!Number.isFinite(base)) continue;
    for (let r = 0; r < n; r++) {
      if (mask & (1 << r)) continue;
      const next = mask | (1 << r), cost = base + entry(d, r).cost;
      // Strict '<' keeps the original order on ties, so symmetric layouts stay stable.
      if (cost < best[d + 1]![next]! - 1e-9) { best[d + 1]![next] = cost; choice[d + 1]![next] = r; }
    }
  }
  const order = new Array<number>(n).fill(0);
  for (let d = n, mask = full; d > 0; d--) { const r = choice[d]![mask]!; order[d - 1] = r; mask &= ~(1 << r); }
  return { order, reversed: order.map((r, d) => entry(d, r).reversed) };
}
/** `homes[i]` is the home of `ids[i]`; when given, regions are re-assigned to minimise total take-off transit. */
export function partitionCoverage(polygon: Position[], spacing: number, ids: string[], heading: number, homes?: Position[]): { regions: CoverageRegion[]; routes: Position[][] } {
  if (!validPlanningPolygon(polygon) || !ids.length || new Set(ids).size !== ids.length) throw new Error('请先闭合有效区域并选择参与无人机');
  if (!Number.isFinite(heading) || !Number.isFinite(spacing) || spacing < 1) throw new Error('扫描航向或航线间距无效');
  const angle = heading * Math.PI / 180;
  const aligned = polygon.map(p => rotate(p, -angle));
  const min = Math.min(...aligned.map(p => p.y)), max = Math.max(...aligned.map(p => p.y));
  const total = polygonArea(aligned), boundaries = [min];
  for (let i = 1; i < ids.length; i++) {
    let low = boundaries[i - 1]!, high = max;
    for (let step = 0; step < 44; step++) {
      const mid = (low + high) / 2;
      if (polygonArea(clipNorth(aligned, mid, false)) < total * i / ids.length) low = mid;
      else high = mid;
    }
    boundaries.push((low + high) / 2);
  }
  boundaries.push(max);
  const regions: CoverageRegion[] = [], routes: Position[][] = [];
  for (let i = 0; i < ids.length; i++) {
    const band = clipNorth(clipNorth(aligned, boundaries[i]!, true), boundaries[i + 1]!, false);
    const shape = band.map(p => rotate(p, angle));
    if (!validPlanningPolygon(shape)) throw new Error(`第 ${i + 1} 分区过窄或不连通，请调整区域形状、减少飞机或改变扫描航向`);
    const name = `${String.fromCharCode(65 + i)}区`;
    let route: Position[];
    // A single centre line does not inspect the whole band. Give each partition
    // two or more clipped parallel passes, even when its width is below spacing.
    try { route = coverageRoutes(shape, spacing, 1, heading, 2)[0]!; }
    catch { throw new Error(`${name}无法生成连续区内航线，请调整区域形状、航向或参与数量`); }
    if (!route.length) throw new Error(`${name}没有有效航点，请减少参与飞机`);
    regions.push({ name, droneId: ids[i]!, area: polygonArea(shape), polygon: shape });
    routes.push(route);
  }
  if (homes && homes.length === ids.length && ids.length > 1 && ids.length <= 15) {
    const { order, reversed } = assignRoutesToHomes(routes, homes);
    // order[d] is the region flown by aircraft d; regions keep their geometric names (A区, B区 ...).
    order.forEach((r, d) => { regions[r] = { ...regions[r]!, droneId: ids[d]! }; if (reversed[d]) routes[r] = [...routes[r]!].reverse(); });
  }
  return { regions, routes };
}
export function planFingerprint(mission: Mission, group: TaskGroup): string {
  return JSON.stringify({name:group.name,config:group.config,points:group.points,closed:group.areaClosed,drones:group.drones,roles:group.roles,homes:group.drones.map(id=>{const d=mission.drones.find(d=>d.id===id);return [id,d?.homePosition,d?.speed];})});
}
/** Sample once when generating the plan; the selected point is persisted in the relay route. */
function automaticRelayPoint(polygon: Position[], altitude: number): Position {
  const minX=Math.min(...polygon.map(p=>p.x)),maxX=Math.max(...polygon.map(p=>p.x));
  const minY=Math.min(...polygon.map(p=>p.y)),maxY=Math.max(...polygon.map(p=>p.y));
  for(let attempt=0;attempt<128;attempt++) {
    const point={x:minX+Math.random()*(maxX-minX),y:minY+Math.random()*(maxY-minY),z:altitude};
    if(insidePolygon(point,polygon)) return point;
  }
  // Extremely thin concave regions can have a tiny bounding-box acceptance ratio.
  const a=polygon[0]!,b=polygon[1]!;
  return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,z:altitude};
}
export function buildMissionPlan(mission: Mission, group: TaskGroup): MissionPlan {
  const index=mission.tasks.findIndex(t=>t.id===group.taskId),z=group.config.altitude;
  const markers=group.points.filter(p=>p.kind==='point').map(p=>({...p,z}));
  let polygon: Position[]=markers;
  if(index===1&&markers.length===1) {
    const center=markers[0]!, radius=group.config.searchRange;
    polygon=Array.from({length:32},(_,i)=>({x:center.x+Math.cos(i*Math.PI/16)*radius,y:center.y+Math.sin(i*Math.PI/16)*radius,z}));
  }
  if((index===0||index===1)&&markers.length>=3&&!group.areaClosed) throw new Error('区域尚未闭合，请先完成绘制');
  const coverageHeading = index < 2 ? group.config.headingMode === 'auto' ? automaticCoverageHeading(polygon) : group.config.heading ?? 0 : undefined;
  const ids=group.drones;
  const searchers=index===1?ids.filter(id=>group.roles[id]!=='中继机'):ids;
  const relayPoint=index===1&&ids.some(id=>group.roles[id]==='中继机')?automaticRelayPoint(polygon,z):undefined;
  // Clockwise patrol deliberately remains a perimeter mission, not a coverage partition.
  const partitioned=index<2 && !(index===0 && group.config.strategy==='顺时针巡逻')
    ? (() => {
        const ordered=group.config.strategy==='协同搜索' || group.config.strategy==='分区巡逻' ? [...searchers].reverse() : searchers;
        // Homes follow `ordered`, so regions go to the aircraft that can reach them with the least transit.
        return partitionCoverage(polygon,group.config.routeSpacing,ordered,coverageHeading!,ordered.map(id=>mission.drones.find(d=>d.id===id)!.homePosition));
      })()
    : undefined;
  const coverage=partitioned?.routes ?? [];
  const start=group.points.find(p=>p.kind==='start'),target=group.points.find(p=>p.kind==='delivery');
  const scout=ids.find(id=>group.roles[id]==='侦察机');
  if(index===4&&group.config.strategy==='先侦察后救援'&&!scout) throw new Error('先侦察后救援至少需要一架侦察机');
  const routes: AircraftRoute[]=ids.map((id,order)=>{
    const d=mission.drones.find(d=>d.id===id)!;
    let work: Position[];
    if(index===1&&group.roles[id]==='中继机') {
      work=[relayPoint!];
    } else if(index<2) {
      work=partitioned?.routes.find((_,i)=>partitioned.regions[i]!.droneId===id) ?? [];
      if(index===0&&group.config.strategy==='顺时针巡逻') {
        // Partition the entire perimeter by arc length, including when aircraft outnumber vertices.
        const lengths=polygon.map((p,i)=>distance3(p,polygon[(i+1)%polygon.length]!));
        const perimeter=lengths.reduce((sum,n)=>sum+n,0),lo=perimeter*order/ids.length,hi=perimeter*(order+1)/ids.length;
        let travelled=0;work=[];
        polygon.forEach((p,i)=>{const next=polygon[(i+1)%polygon.length]!,length=lengths[i]!,from=Math.max(lo,travelled),to=Math.min(hi,travelled+length);
          if(to>from+1e-8) {const at=(distance:number)=>({...p,x:p.x+(next.x-p.x)*distance/length,y:p.y+(next.y-p.y)*distance/length});if(!work.length) work.push(at(from-travelled));work.push(at(to-travelled));} travelled+=length;
        });
      }
    } else if(index===2) {
      // Successors wait at their own Home until the handover trigger. A detour
      // waypoint is not a holding point: the simulator would fly through it and
      // waste the overlap window, possibly timing out the monitoring mission.
      work = [markers[0]!];
    }
    else if(index===3) work=[{...start!,z},...markers,{...target!,z}];
    else if(group.roles[id]==='中继机') work=[{x:(start!.x+target!.x)/2,y:(start!.y+target!.y)/2,z}];
    else work=[{...start!,z},...markers,{...target!,z}];
    const altitude = z + order * 5;
    if (altitude > 120) throw new Error('分机高度分层超出 120 m 模拟上限，请降低基准高度或减少参与数量');
    const waypoints=[{...d.homePosition,z:altitude},...work.map(p=>({...p,z:altitude}))];
    const length=pathLength([d.homePosition,...waypoints])+distance3(waypoints.at(-1)!,{...d.homePosition,z:altitude})+altitude;
    // 定点监测：每架飞机监测一个周期，relayCycles 是总轮次，每架飞机实际监测 duration 秒
    // 接力模式：第一架监测 duration 秒，第二架到达时交接返航；第二架监测 duration 秒，依此类推
    const stationSeconds=index===2?group.config.duration:index===4&&group.roles[id]!=='中继机'?Math.max(2,group.config.duration):0;
    return {droneId:id,role:group.roles[id]!,waypoints,workStart:1,length,estimatedSeconds:length/Math.max(1,d.speed)+stationSeconds+altitude/3+altitude/2.5+waypoints.length*.4,stationSeconds,order,
      dependsOn:index===2&&order>0?ids[order-1]:index===4&&group.config.strategy==='先侦察后救援'&&id!==scout&&group.roles[id]!=='中继机'?scout:undefined};
  });
  if(routes.some(r=>r.waypoints.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||!Number.isFinite(p.z)))) throw new Error('航线坐标无效');
  if(routes.some(r=>r.estimatedSeconds>mission.drones.find(d=>d.id===r.droneId)!.endurance*60*.7 * mission.drones.find(d=>d.id===r.droneId)!.battery/100)) throw new Error('预计任务耗时超过机型续航安全预算，请缩小范围或拆分任务');
  if(routes.reduce((sum,r)=>sum+r.waypoints.length,0)>4000) throw new Error('航点数量过大，请简化区域或增大间距');
  const lastLane = coverage[0]?.slice(-2), nextLane = coverage[1]?.slice(0,2);
  const defaultTarget = lastLane?.length === 2 ? {x:(lastLane[0]!.x+lastLane[1]!.x)/2,y:nextLane?.length===2?(lastLane[0]!.y+nextLane[0]!.y)/2:lastLane[0]!.y,z} : polygon[0];
  const candidateTarget=defaultTarget&&insidePolygon(defaultTarget,polygon)?defaultTarget:coverage[0]?.[0]??polygon[0];
  if(index===1&&(group.config.targetEast===undefined)!==(group.config.targetNorth===undefined)) throw new Error('演练目标坐标须同时填写 E 和 N，或两项都留空使用自动目标');
  const searchTarget=index===1?{x:group.config.targetEast??candidateTarget!.x,y:group.config.targetNorth??candidateTarget!.y,z}:undefined;
  if(searchTarget&&!insidePolygon(searchTarget,polygon)) throw new Error('演练目标必须位于搜索范围内');
  return {id:`plan-${Date.now()}-${++planSequence}`,fingerprint:planFingerprint(mission,group),createdAt:Date.now(),area:index<2?polygonArea(polygon):0,coverageHeading,regions:partitioned?.regions,routes,stage:'planned',receipts:[],searchTarget,
    warnings:[...(index===1&&relayPoint?['中继点在生成航线时自动选取并固定；中继机到点驻留至搜索收尾，不参与扫描和目标确认。']:[]),...(index===4&&ids.some(id=>group.roles[id]==='中继机')?['救援中继机提前到集结点与事件点之间驻留，任务收尾返航；仅演练岗位协同，不模拟真实通信转发或信号覆盖。']:[]),'各机采用 5 m 高度分层，但未实现真实空域冲突解算或飞控避碰。','二维规则规划，不含真实地形、障碍物与空域许可校验；不构成真实飞行放行。',...(index===2&&group.config.handover==='到点交接'?['顺序接力存在转场空窗，执行时记录空窗时长。']:[])]};
}
let planSequence=0;

export function initialTaskExecution(group: TaskGroup): TaskExecution {
  const taskIndex = ['area-coverage', 'target-search', 'station-monitoring', 'delivery', 'emergency-response'].indexOf(group.taskId.split('-')[0] + '-' + group.taskId.split('-')[1]);
  return {seconds:0,reconConfirmed:false,awaiting:null,targetFound:false,confirmedBy:[],handovers:0,gapSeconds:0,
    aircraft:group.drones.map(droneId=>{
      const route = group.plan?.routes.find(r => r.droneId === droneId);
      return {droneId,phase:'queued',waypoint:0,dwell:0,completed:false,
        remainingStationSeconds: taskIndex === 2 && route ? route.stationSeconds : undefined
      };
    })};
}
