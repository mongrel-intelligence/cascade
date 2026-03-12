import type { AgentInput, ProjectConfig } from '../types/index.js';
import { logger } from '../utils/logging.js';
import type { AgentEngine, AgentEngineResult } from './types.js';

/**
 * Post-process an engine result: validate PR creation for agents that require it
 * and zero out cost for subscription-backed Claude Code sessions.
 */
export function postProcessResult(
	result: AgentEngineResult,
	agentType: string,
	engine: AgentEngine,
	input: AgentInput & { project: ProjectConfig },
	identifier: string,
	options?: { requiresPR?: boolean },
): void {
	// Validate PR creation for agents that require it (e.g., implementation)
	if (options?.requiresPR && result.success && !result.prUrl) {
		logger.warn(`${agentType} agent completed without creating a PR`, {
			identifier,
			engine: engine.definition.id,
		});
		result.success = false;
		result.error = 'Agent completed but no PR was created';
	}

	// Zero out cost for subscription-backed Claude Code sessions
	if (
		engine.definition.id === 'claude-code' &&
		input.project.agentEngine?.subscriptionCostZero === true &&
		result.cost !== undefined &&
		result.cost > 0
	) {
		logger.info('Zeroing Claude Code cost (subscription mode)', {
			originalCost: result.cost,
			project: input.project.id,
		});
		result.cost = 0;
	}
}
