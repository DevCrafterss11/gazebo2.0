import type { SecurityScenarioAdapter, ScenarioNode } from '../contracts/securityScenario';
import { scenarios, type ScenarioId, type ScenarioPhase } from '../../pages/experiments/security/scenarios';

/** Never sends flight or attack commands. Device integration must be explicitly selected later. */
export class MockSecurityScenarioAdapter implements SecurityScenarioAdapter {
  readonly mode = 'demo' as const;
  async getNodes(id: ScenarioId): Promise<ScenarioNode[]> {
    const scenario = scenarios.find(item => item.id === id)!;
    return scenario.drones.map((droneId, index) => ({ droneId, nodeId: scenario.nodes[index]!, connected: false }));
  }
  async transition(_id: ScenarioId, phase: ScenarioPhase, action: 'attack' | 'protect' | 'restore'): Promise<ScenarioPhase> {
    if (action === 'attack' && phase === 'baseline') return 'attacked';
    if (action === 'protect' && phase === 'attacked') return 'protected';
    if (action === 'restore' && phase !== 'baseline') return 'baseline';
    throw new Error('当前阶段不允许此操作');
  }
}
