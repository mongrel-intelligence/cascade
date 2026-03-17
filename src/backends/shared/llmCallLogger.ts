import { storeLlmCall } from '../../db/repositories/runsRepository.js';
import { logger } from '../../utils/logging.js';

export interface LlmCallLogPayload {
	/** The run ID. If undefined or empty, the call is a no-op. */
	runId: string | undefined;
	/** Sequential call number within the run. */
	callNumber: number;
	/** Model identifier string. */
	model: string;
	/** Number of input tokens consumed. */
	inputTokens?: number;
	/** Number of output tokens generated. */
	outputTokens?: number;
	/** Number of cached tokens (optional; some engines don't report this). */
	cachedTokens?: number;
	/** Cost in USD (optional; some engines don't report this). */
	costUsd?: number;
	/** Raw response payload to store (optional). */
	response?: string;
	/** Human-readable engine label used in warning logs (e.g. "Claude Code"). */
	engineLabel: string;
}

/**
 * Shared fire-and-forget helper for storing LLM call records.
 *
 * Guards on runId (no-op when absent), calls storeLlmCall asynchronously,
 * and catches/logs any storage errors using the engine label for context.
 * Returns void — callers do not need to await.
 */
export function logLlmCall(payload: LlmCallLogPayload): void {
	if (!payload.runId) return;

	storeLlmCall({
		runId: payload.runId,
		callNumber: payload.callNumber,
		request: undefined,
		response: payload.response,
		inputTokens: payload.inputTokens,
		outputTokens: payload.outputTokens,
		cachedTokens: payload.cachedTokens,
		costUsd: payload.costUsd,
		durationMs: undefined,
		model: payload.model,
	}).catch((err) => {
		logger.warn(`Failed to store ${payload.engineLabel} LLM call in real-time`, {
			runId: payload.runId,
			call: payload.callNumber,
			error: String(err),
		});
	});
}
