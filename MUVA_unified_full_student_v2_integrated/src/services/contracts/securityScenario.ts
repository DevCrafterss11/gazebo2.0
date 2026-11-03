import type { ScenarioId, ScenarioPhase } from '../../types/securityScenario';

/** Reserved integration boundary; a Pi adapter must report actual connectivity and confirmed operations. */
export interface ScenarioNode { droneId: string; nodeId: string; connected: boolean; lastSeenAt?: string }
export interface SecurityScenarioAdapter {
  readonly mode: 'demo' | 'device';
  getNodes(scenario: ScenarioId): Promise<ScenarioNode[]>;
  transition(scenario: ScenarioId, phase: ScenarioPhase, action: 'attack' | 'protect' | 'restore'): Promise<ScenarioPhase>;
}

/** Future Raspberry Pi gateway contract (not implemented or registered in this release).
 * Real adapters must authenticate commands, correlate request IDs, and only advance
 * the phase after a device acknowledgement and verifiable mission outcome.
 */
export interface RaspberryPiScenarioCommand {
  requestId: string;
  scenario: ScenarioId;
  groupId: string;
  targetDroneId: string;
  targetNodeId: string;
  action: 'attack' | 'protect' | 'restore';
}
export interface RaspberryPiScenarioOutcome {
  requestId: string;
  accepted: boolean;
  acknowledgedAt: string;
  phase: ScenarioPhase;
  /** Values must carry units and observation semantics, not demo estimates. */
  metrics: Array<{ name: string; value: number; unit: string; observedAt: string }>;
}
export interface RaspberryPiSecurityGateway {
  getNodeStatus(groupId: string): Promise<ScenarioNode[]>;
  submit(command: RaspberryPiScenarioCommand): Promise<RaspberryPiScenarioOutcome>;
}
