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
	options?: { requiresPR?: boolean; requiresReview?: boolean; hasAuthoritativeReview?: boolean },
): void {
	// Validate PR creation for agents that require it (e.g., implementation)
	if (options?.requiresPR && result.success && !result.prEvidence?.authoritative) {
		logger.warn(`${agentType} agent completed without authoritative PR evidence`, {
			identifier,
			engine: engine.definition.id,
			prUrl: result.prUrl,
			prEvidenceSource: result.prEvidence?.source ?? null,
		});
		result.success = false;
		result.error = 'Agent completed but no authoritative PR creation was recorded';
	}

	if (options?.requiresReview && result.success && !options.hasAuthoritativeReview) {
		logger.warn(`${agentType} agent completed without authoritative review evidence`, {
			identifier,
			engine: engine.definition.id,
		});
		result.success = false;
		result.error = 'Agent completed but no authoritative PR review submission was recorded';
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
