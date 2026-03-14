import { logger } from '../utils/logging.js';
import type { AgentEngine, AgentEngineResult } from './types.js';

/**
 * Post-process an engine result: validate PR creation for agents that require it.
 */
export function postProcessResult(
	result: AgentEngineResult,
	agentType: string,
	engine: AgentEngine,
	_input: unknown,
	identifier: string,
	options?: {
		requiresPR?: boolean;
		requiresReview?: boolean;
		requiresPushedChanges?: boolean;
		hasAuthoritativeReview?: boolean;
		hasAuthoritativePushedChanges?: boolean;
	},
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

	if (
		options?.requiresPushedChanges &&
		result.success &&
		options.hasAuthoritativePushedChanges === false
	) {
		logger.warn(`${agentType} agent completed without authoritative pushed-change evidence`, {
			identifier,
			engine: engine.definition.id,
		});
		result.success = false;
		result.error = 'Agent completed but no authoritative pushed changes were recorded';
	}
}
