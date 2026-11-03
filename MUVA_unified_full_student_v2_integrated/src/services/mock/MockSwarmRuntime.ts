import { distance, homes, swarmFrame } from '../../domain/swarmGeometry';
import { segmentDistance, shortestRoute, type RoutingBox, type RoutingSegment } from '../../domain/swarmRouting';
import { planParallelRoutes } from '../../domain/swarmDeconfliction';
import { acceptedMissions, completeMissionPath } from '../../domain/swarmMissionWorkflow';
import type { SwarmService } from '../swarmContract';
import type { Point, SwarmConfig, SwarmDrone, SwarmMission, SwarmMissionReceipt, SwarmSnapshot } from '../../types/swarm';

const clone = (snapshot: SwarmSnapshot): SwarmSnapshot => structuredClone(snapshot);
const terminal = (state: SwarmDrone['state']) => state === 'LANDED';

export class MockSwarmRuntime implements SwarmService {
  readonly mode = 'mock' as const;
  readonly label = '浏览器 Mock';
  private snapshot: SwarmSnapshot = { status: 'DRAFT', drones: [], elapsed: 0, events: [], coverage: 0 };
  private missions: SwarmMission[] = [];
  private config: SwarmConfig | null = null;
  private listener: ((snapshot: SwarmSnapshot) => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTime = 0;
  private reservations = new Map<string, RoutingSegment>();
  private waiting = new Set<string>();
  private dispatchOrder: string[] = [];
  private pendingUpload: { timer: ReturnType<typeof setTimeout>; reject: (error: Error) => void } | null = null;

  initialize(config: SwarmConfig): SwarmSnapshot {
    this.dispose();
    this.config = config;
    this.missions = [];
    const drones: SwarmDrone[] = homes(config.count, undefined, config.sceneOrigin).map((homePosition, index) => ({
      droneId: `UAV-${String(index + 1).padStart(2, '0')}`, displayName: `UAV-${String(index + 1).padStart(2, '0')}`, modelType: 'Iris', sysId: index + 1,
      homePosition, position: homePosition, targetAltitude: config.altitude, cruiseSpeed: config.speed, altitude: 0, speed: 0, heading: 0, battery: 100,
      state: 'READY', waypointIndex: 0, progress: 0, trajectory: [homePosition], completedSegments: 0,
    }));
    this.snapshot = { status: 'DRAFT', drones, elapsed: 0, events: ['Mock 仿真环境已就绪'], coverage: 0 };
    this.publish();
    return this.getStatus();
  }
  restore(config: SwarmConfig, missions: SwarmMission[], snapshot: SwarmSnapshot): SwarmSnapshot {
    this.dispose();
    this.config = structuredClone(config);
    this.missions = structuredClone(missions);
    this.snapshot = clone(snapshot);
    delete this.snapshot.interrupted;
    this.prepareDispatch();
    this.snapshot.drones.filter((drone) => drone.state === 'RETURNING' && !drone.returnWaypoints).forEach((drone) => { this.prepareReturn(drone); });
    if (['TAKING_OFF', 'HOLDING', 'RUNNING', 'PAUSED', 'RETURNING'].includes(this.snapshot.status)) this.startClock();
    return this.getStatus();
  }
  loadMission(missions: SwarmMission[]): void {
    if (['TAKING_OFF', 'HOLDING', 'RUNNING', 'PAUSED', 'RETURNING'].includes(this.snapshot.status)) throw new Error('飞行中禁止更换航线');
    this.cancelUpload(); this.missions = structuredClone(missions); this.snapshot.status = missions.length ? 'PLANNED' : 'DRAFT'; this.snapshot.missionPlanId = undefined; this.snapshot.missionReceipts = []; this.publish();
  }
  uploadMission(missions: SwarmMission[], planId: string): Promise<SwarmMissionReceipt[]> {
    return new Promise((resolve, reject) => {
      this.ensure(['PLANNED']);
      if (!planId || !this.config || missions.length !== this.snapshot.drones.length || new Set(missions.map((mission) => mission.droneId)).size !== missions.length
        || new Set(missions.map((mission) => mission.missionId)).size !== missions.length || JSON.stringify(missions) !== JSON.stringify(this.missions)) throw new Error('下发任务与当前计划或机群不匹配');
      missions.forEach((mission) => {
        const drone = this.snapshot.drones.find((item) => item.droneId === mission.droneId);
        const path = completeMissionPath(mission, drone);
        if (!drone || !mission.coverageSegments.length || path.length < 3 || path.some((point) => point.some((value) => !Number.isFinite(value)))) throw new Error('下发航线存在无效编号或航点');
      });
      this.cancelUpload();
      const timer = setTimeout(() => {
        this.pendingUpload = null;
        const receivedAt = new Date().toISOString();
        const receipts: SwarmMissionReceipt[] = this.missions.map((mission) => ({ planId, missionId: mission.missionId, droneId: mission.droneId,
          status: 'ACCEPTED', waypointCount: completeMissionPath(mission, this.snapshot.drones.find((drone) => drone.droneId === mission.droneId)).length,
          receivedAt, message: '航线接收成功' }));
        this.snapshot.missionReceipts = receipts;
        this.snapshot.missionPlanId = planId;
        receipts.forEach((receipt) => this.log(`${receipt.droneId} ✓ ${receipt.message}（${receipt.waypointCount} 个完整路径航点）`));
        this.publish(); resolve(structuredClone(receipts));
      }, 240);
      this.pendingUpload = { timer, reject };
    });
  }
  private cancelUpload(): void {
    if (!this.pendingUpload) return;
    clearTimeout(this.pendingUpload.timer); this.pendingUpload.reject(new Error('航线下发已取消：计划或实验发生变化')); this.pendingUpload = null;
  }
  private ensureUploaded(): void {
    if (!this.snapshot.missionPlanId || !acceptedMissions(this.missions, this.snapshot.missionReceipts ?? [], this.snapshot.drones, this.snapshot.missionPlanId)) throw new Error('请先下发航线并确认全部无人机接收成功');
  }
  markReady(): void { this.ensure(['PLANNED', 'READY']); this.ensureUploaded(); this.snapshot.status = 'READY'; this.publish(); }
  getFleet(): SwarmDrone[] { return this.getStatus().drones; }
  getStatus(): SwarmSnapshot { return clone(this.snapshot); }
  subscribeTelemetry(listener: (snapshot: SwarmSnapshot) => void): () => void { this.listener = listener; listener(this.getStatus()); return () => { if (this.listener === listener) this.listener = null; }; }
  private publish(): void { this.listener?.(this.getStatus()); }
  private log(message: string): void { this.snapshot.events = [...this.snapshot.events.slice(-79), `${Math.round(this.snapshot.elapsed)}s · ${message}`]; }
  private ensure(states: SwarmSnapshot['status'][]): void { if (!states.includes(this.snapshot.status)) throw new Error(`当前状态 ${this.snapshot.status} 不允许执行此操作`); }
  private startClock(): void { if (this.timer) return; this.lastTime = performance.now(); this.timer = setInterval(() => { const now = performance.now(); this.tick(Math.min(0.5, (now - this.lastTime) / 1000)); this.lastTime = now; }, 250); }
  private halt(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }
  takeoff(): void { this.ensure(['READY']); this.ensureUploaded(); this.snapshot.status = 'TAKING_OFF'; this.snapshot.drones.forEach((drone) => { drone.state = 'TAKING_OFF'; }); this.log('机群分时起飞'); this.startClock(); this.publish(); }
  startMission(): void { this.ensure(['HOLDING']); this.prepareDispatch(); this.snapshot.status = 'RUNNING'; this.snapshot.drones.filter((drone) => drone.state === 'HOLDING').forEach((drone) => { drone.state = 'RUNNING'; }); this.log('多机并行执行；交叉航段自动局部等待避让'); this.publish(); }
  pauseMission(): void { this.ensure(['RUNNING']); this.reservations.clear(); this.snapshot.status = 'PAUSED'; this.snapshot.drones.filter((drone) => drone.state === 'RUNNING').forEach((drone) => { drone.state = 'PAUSED'; drone.speed = 0; }); this.log('任务暂停，原地悬停'); this.publish(); }
  resumeMission(): void { this.ensure(['PAUSED']); this.snapshot.status = 'RUNNING'; this.snapshot.drones.filter((drone) => drone.state === 'PAUSED').forEach((drone) => { drone.state = 'RUNNING'; }); this.log('继续覆盖任务'); this.publish(); }
  returnDroneToHome(droneId: string): void {
    this.ensure(['TAKING_OFF', 'HOLDING', 'RUNNING', 'PAUSED', 'RETURNING']);
    const drone = this.snapshot.drones.find((item) => item.droneId === droneId);
    if (!drone || terminal(drone.state) || drone.state === 'RETURNING') throw new Error('该无人机当前无法返航');
    this.reservations.clear(); drone.state = 'RETURNING'; drone.returnMode = 'RTL'; drone.returnWaypoints = [[...drone.homePosition]]; this.log(`${droneId} 模拟 RTL 直接返航，剩余覆盖任务不再分配`); this.publish();
  }
  returnToHome(): void {
    this.ensure(['TAKING_OFF', 'HOLDING', 'RUNNING', 'PAUSED', 'RETURNING']);
    this.reservations.clear(); this.snapshot.status = 'RETURNING';
    this.snapshot.drones.filter((drone) => !terminal(drone.state)).forEach((drone) => {
      drone.state = 'RETURNING';
      drone.returnMode = 'RTL';
      drone.returnWaypoints = [[...drone.homePosition]];
    });
    this.log('集群并行模拟 RTL 返航，各机独立降落'); this.startClock(); this.publish();
  }
  stop(): void { this.halt(); }
  shutdown(): void { this.dispose(); }
  dispose(): void { this.halt(); this.cancelUpload(); this.reservations.clear(); this.waiting.clear(); this.dispatchOrder = []; this.listener = null; }
  private prepareReturn(drone: SwarmDrone): boolean {
    try {
      drone.returnMode = 'planned';
      drone.returnWaypoints = this.safeReturn(drone);
      return true;
    } catch (error: unknown) {
      drone.speed = 0;
      const message = `${drone.droneId} 返航路径暂不可用，悬停等待重新规划：${error instanceof Error ? error.message : '路径受阻'}`;
      if (!this.snapshot.events.some((event) => event.endsWith(message))) this.log(message);
      return false;
    }
  }
  private safeReturn(drone: SwarmDrone): Point[] {
    const mission = this.missions.find((item) => item.droneId === drone.droneId);
    const { toLocal, toGeo } = swarmFrame(this.config?.sceneOrigin);
    const margin = (this.config?.safety ?? 3) - 0.0001;
    const waiting: RoutingBox[] = this.snapshot.drones.filter((other) => other.droneId !== drone.droneId && other.altitude > .01
      && Math.abs(other.altitude - drone.altitude) < margin).map((other) => {
      const [east, north] = toLocal(other.position);
      return [east - margin, north - margin, east + margin, north + margin];
    });
    return shortestRoute(toLocal(drone.position), toLocal(drone.homePosition), [...(mission?.routingObstacles ?? []), ...waiting]).slice(1).map(toGeo);
  }
  private prepareDispatch(): void {
    if (!this.config || !this.missions.length) return;
    const { toLocal } = swarmFrame(this.config.sceneOrigin);
    const schedule = planParallelRoutes(this.missions.map((mission) => completeMissionPath(mission, this.snapshot.drones.find((drone) => drone.droneId === mission.droneId)).map(toLocal)),
      this.config.safety, this.config.speed, this.config.altitude / 5);
    this.dispatchOrder = schedule.order.map((index) => this.missions[index]!.droneId);
  }
  private canMove(drone: SwarmDrone, target: Point): boolean {
    if (this.reservations.has(drone.droneId)) return true;
    const { toLocal } = swarmFrame(this.config?.sceneOrigin);
    const segment: RoutingSegment = [toLocal(drone.position), toLocal(target)];
    const clearance = this.config?.safety ?? 3;
    const available = this.snapshot.drones.every((other) => {
      if (other.droneId === drone.droneId || terminal(other.state)) return true;
      const vertical = Math.abs(drone.altitude - other.altitude);
      if (vertical >= clearance) return true;
      const position = toLocal(other.position);
      const reserved = this.reservations.get(other.droneId);
      return segmentDistance(segment, [position, position]) >= Math.sqrt(clearance ** 2 - vertical ** 2) - .01
        && (!reserved || segmentDistance(segment, reserved) >= clearance - .01);
    });
    if (!available) {
      drone.speed = 0;
      if (!this.waiting.has(drone.droneId)) { this.waiting.add(drone.droneId); this.log(`${drone.droneId} 交叉航段局部避让等待，其余航线继续并行`); }
      return false;
    }
    this.reservations.set(drone.droneId, segment);
    if (this.waiting.delete(drone.droneId)) this.log(`${drone.droneId} 冲突航段已释放，自动继续`);
    return true;
  }
  private move(drone: SwarmDrone, target: Point, delta: number): boolean {
    const { toLocal } = swarmFrame(this.config?.sceneOrigin);
    const from = toLocal(drone.position); const to = toLocal(target); const remaining = distance(from, to);
    const travel = Math.min(remaining, drone.cruiseSpeed * delta);
    if (remaining > 0.01) {
      drone.heading = Math.atan2(to[0] - from[0], to[1] - from[1]) * 180 / Math.PI;
      drone.position = [drone.position[0] + (target[0] - drone.position[0]) * travel / remaining, drone.position[1] + (target[1] - drone.position[1]) * travel / remaining];
      drone.speed = travel / delta;
      drone.battery = Math.max(0, drone.battery - travel * 0.003);
      if (travel > 0) drone.trajectory.push(drone.position);
    }
    if (remaining <= travel + 0.01) {
      const atTarget = distance(toLocal(drone.position), to) < 1e-9;
      drone.position = [...target];
      if (!atTarget) drone.trajectory.push(drone.position);
      return true;
    }
    return false;
  }
  tick(delta: number): void {
    if (!this.config || delta <= 0 || ['COMPLETED', 'ABORTED', 'FAILED'].includes(this.snapshot.status)) return;
    if (this.snapshot.status === 'PAUSED' && !this.snapshot.drones.some((drone) => drone.state === 'RETURNING')) return;
    this.snapshot.elapsed += delta;
    const ordered = [...this.snapshot.drones].sort((first, second) => this.dispatchOrder.indexOf(first.droneId) - this.dispatchOrder.indexOf(second.droneId));
    ordered.forEach((drone) => {
      if (drone.state === 'TAKING_OFF') {
        drone.altitude = Math.min(drone.targetAltitude, drone.altitude + 5 * delta);
        if (drone.altitude === drone.targetAltitude) { drone.state = 'HOLDING'; this.log(`${drone.droneId} 起飞完成，悬停待命`); }
      } else if (drone.state === 'RUNNING') {
        const mission = this.missions.find((item) => item.droneId === drone.droneId);
        const target = mission?.waypoints[drone.waypointIndex];
        if (!target) { drone.state = 'RETURNING'; this.prepareReturn(drone); return; }
        if (!this.canMove(drone, target)) return;
        if (this.move(drone, target, delta)) {
          this.reservations.delete(drone.droneId);
          drone.waypointIndex += 1;
          if (mission?.coverageWaypointIndices ? mission.coverageWaypointIndices.includes(drone.waypointIndex - 1) : drone.waypointIndex >= 2 && drone.waypointIndex % 2 === 0) drone.completedSegments += 1;
          drone.progress = Math.min(100, drone.completedSegments / (mission?.coverageSegments.length || 1) * 100);
          if (drone.waypointIndex >= (mission?.waypoints.length || 0)) { drone.state = 'RETURNING'; drone.speed = 0; drone.returnWaypoints = mission?.returnPath?.slice(1); if (!drone.returnWaypoints) this.prepareReturn(drone); this.log(`${drone.droneId} 覆盖完成，立即独立返航`); }
        }
      } else if (drone.state === 'RETURNING') {
        if (!drone.returnWaypoints && !this.prepareReturn(drone)) return;
        const path = drone.returnWaypoints;
        if (!path) return;
        const target = path[0];
        const directHome = drone.returnMode === 'RTL';
        if (target && !directHome && !this.canMove(drone, target)) return;
        if (target && this.move(drone, target, delta)) { this.reservations.delete(drone.droneId); path.shift(); }
        if (!path.length) { drone.speed = 0; drone.altitude = Math.max(0, drone.altitude - 5 * delta); if (drone.altitude === 0) { drone.state = 'LANDED'; this.log(`${drone.droneId} 已安全降落`); } }
      }
    });
    const total = this.missions.reduce((sum, mission) => sum + mission.coverageSegments.length, 0);
    this.snapshot.coverage = total ? this.snapshot.drones.reduce((sum, drone) => sum + drone.completedSegments, 0) / total * 100 : 0;
    if (this.snapshot.status === 'RUNNING' && !this.snapshot.drones.some((drone) => drone.state === 'RUNNING') && this.snapshot.drones.some((drone) => drone.state === 'RETURNING')) {
      this.snapshot.status = 'RETURNING'; this.log('已完成各自覆盖的无人机正在独立返航');
    }
    if (this.snapshot.status === 'TAKING_OFF' && this.snapshot.drones.every((drone) => drone.state === 'HOLDING')) { this.snapshot.status = 'HOLDING'; this.log('机群悬停就绪'); }
    if (this.snapshot.drones.length && this.snapshot.drones.every((drone) => terminal(drone.state))) {
      this.snapshot.status = this.snapshot.coverage >= 99.9 ? 'COMPLETED' : 'ABORTED'; this.log(this.snapshot.status === 'COMPLETED' ? '全部任务完成' : '任务部分完成，安全结束'); this.halt();
    }
    this.publish();
  }
}
