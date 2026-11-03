import type { BasicAttackConfig } from '../domain/basicAttackConfig';
import type { Mission, TaskEvent, EvaluationResult, TaskGroup, DeploymentReceipt, FlightCommand } from '../types/collaboration';

/** Experiment 3 gateway boundary. Real 15-node capabilities remain unavailable. */
export interface CollaborationRuntimeAdapter {
  readonly source: 'Mock' | 'SITL' | 'Raspberry Pi Relay' | 'Hardware';
  /** Positions are ENU metres relative to Mission.mapReference (not marker indices).
   * Real adapters must supply the world georeference and normalize Gazebo/NED axes. */
  createInitialMission(): Mission;
  startCluster(onProgress: (progress: number) => void, onReady: () => void, onHeartbeat: () => void): void;
  stopCluster(): void;
  start(getMission: () => Mission, onUpdate: (mission: Mission) => void, isPaused?: () => boolean): void;
  evaluate(mission: Mission, events: TaskEvent[], duration: number, status?: string): EvaluationResult;
  command(mission: Mission, droneId: string, command: FlightCommand): { mission: Mission; accepted: boolean; detail: string };
  deploy(mission: Mission, group: TaskGroup, stage: 'upload' | 'arm'): DeploymentReceipt[];
  startGpsAttack(mission: Mission, config: BasicAttackConfig): Mission;
  stopGpsAttack(mission: Mission, droneIds?: string[]): Mission;
  stop(): void;
}
