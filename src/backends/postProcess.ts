import { captureException } from '../sentry.js';
import { logger } from '../utils/logging.js';
import {
	COMPLETION_ERROR_NO_PM_WRITE,
	COMPLETION_ERROR_NO_PR,
	COMPLETION_ERROR_NO_PUSH,
	COMPLETION_ERROR_NO_REVIEW,
	type PushedChangesEvaluation,
} from './completion.js';
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
		requiresPMWrite?: boolean;
		hasAuthoritativeReview?: boolean;
		/** Shared pushed-changes verdict (`evaluatePushedChanges`); absent when no sidecar was expected. */
		pushedChangesEvaluation?: PushedChangesEvaluation;
		/** Error recorded when every pushed-changes outcome is rejected; defaults to the legacy no-push error. */
		pushedChangesError?: string;
		hasPMWrite?: boolean;
	},
): void {
	// Validate PR creation for agents that require it (e.g., implementation).
	// Prod regression 2026-05-09 (run d8e31665): the no-authoritative-PR failure
	// surfaced only as a per-run record + a one-line WARN. Operators reading
	// `cascade runs list` saw "failed" with no idea whether this is a recurring
	// regression. Sentry capture under a stable tag makes prod frequency loud
	// and gives ops a single dashboard to monitor.
	if (options?.requiresPR && result.success && !result.prEvidence?.authoritative) {
		const prEvidenceSource = result.prEvidence?.source ?? null;
		logger.warn(`${agentType} agent completed without authoritative PR evidence`, {
			identifier,
			engine: engine.definition.id,
			prUrl: result.prUrl,
			prEvidenceSource,
		});
		captureException(new Error(COMPLETION_ERROR_NO_PR), {
			tags: {
				source: 'pr_sidecar_invalid',
				engine: engine.definition.id,
				agentType,
			},
			extra: {
				identifier,
				prUrl: result.prUrl,
				prEvidenceSource,
			},
		});
		result.success = false;
		result.error = COMPLETION_ERROR_NO_PR;
	}

	if (options?.requiresReview && result.success && !options.hasAuthoritativeReview) {
		logger.warn(`${agentType} agent completed without authoritative review evidence`, {
			identifier,
			engine: engine.definition.id,
		});
		result.success = false;
		result.error = COMPLETION_ERROR_NO_REVIEW;
	}

	if (options?.requiresPushedChanges && result.success && options.pushedChangesEvaluation) {
		const evaluation = options.pushedChangesEvaluation;
		if (evaluation.satisfiedBy === null) {
			logger.warn(`${agentType} agent completed without authoritative pushed-change evidence`, {
				identifier,
				engine: engine.definition.id,
				rejections: evaluation.rejections,
			});
			result.success = false;
			result.error = options.pushedChangesError ?? COMPLETION_ERROR_NO_PUSH;
		} else {
			logger.info(`${agentType} agent satisfied the pushed-changes requirement`, {
				identifier,
				engine: engine.definition.id,
				pushedChangesOutcome: evaluation.satisfiedBy,
			});
		}
	}

	if (options?.requiresPMWrite && result.success && options.hasPMWrite === false) {
		logger.warn(`${agentType} agent completed without PM write evidence`, {
			identifier,
			engine: engine.definition.id,
		});
		result.success = false;
		result.error = COMPLETION_ERROR_NO_PM_WRITE;
	}
}
