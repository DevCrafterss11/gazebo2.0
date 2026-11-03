import type { BasicAttackConfig } from '../domain/basicAttackConfig';
import type { Position } from './collaboration';

/** A task-run scoped positioning disturbance. Ground truth remains Drone.position. */
export interface GpsAttackState {
  id: string;
  runId: string;
  groupId: string;
  config: BasicAttackConfig;
  elapsed: number;
  phase: 'delayed' | 'active' | 'paused';
  offset: Position;
}
