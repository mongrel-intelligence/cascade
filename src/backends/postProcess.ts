import type { AgentInput, ProjectConfig } from '../types/index.js';
import { logger } from '../utils/logging.js';
import type { AgentBackend, AgentBackendResult } from './types.js';

/**
 * Post-process a backend result: validate PR creation for implementation agents
 * and zero out cost for subscription-backed Claude Code sessions.
 */
export function postProcessResult(
	result: AgentBackendResult,
	agentType: string,
	backend: AgentBackend,
	input: AgentInput & { project: ProjectConfig },
	identifier: string,
): void {
	// Validate PR creation for implementation agents
	if (agentType === 'implementation' && result.success && !result.prUrl) {
		logger.warn('Implementation agent completed without creating a PR', {
			identifier,
			backend: backend.name,
		});
		result.success = false;
		result.error = 'Implementation completed but no PR was created';
	}

	// Zero out cost for subscription-backed Claude Code sessions
	if (
		backend.name === 'claude-code' &&
		input.project.agentBackend?.subscriptionCostZero === true &&
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
