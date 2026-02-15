/**
 * Shared observer hooks for agent LLM call logging.
 *
 * These hooks provide visibility into:
 * - LLM call start/complete timing
 * - Rate limit throttling events
 * - Retry attempts
 */

import type {
	ObserveLLMCallContext,
	ObserveLLMCompleteContext,
	ObserveRateLimitThrottleContext,
	ObserveRetryAttemptContext,
} from 'llmist';

import type { ProgressMonitor } from '../../backends/progressMonitor.js';
import type { LLMCallLogger } from '../../utils/llmLogging.js';
import { calculateCost } from '../../utils/llmMetrics.js';
import { type TrackingContext, checkForLoopAndAdvance, incrementLLMIteration } from './tracking.js';

/** Function signature for writing to cascade log file */
export type LogWriter = (level: string, message: string, context?: Record<string, unknown>) => void;

/** Accumulated per-call metrics collected during agent execution */
export interface AccumulatedLlmCall {
	callNumber: number;
	inputTokens?: number;
	outputTokens?: number;
	cachedTokens?: number;
	costUsd?: number;
	durationMs?: number;
}

/** Configuration for creating observer hooks */
export interface ObserverHooksConfig {
	/** Model name for cost calculation */
	model: string;
	/** Function to write logs to cascade log file */
	logWriter: LogWriter;
	/** Tracking context for iteration metrics */
	trackingContext: TrackingContext;
	/** Logger for raw LLM request/response logging */
	llmCallLogger: LLMCallLogger;
	/** Optional progress monitor for feeding iteration state */
	progressMonitor?: ProgressMonitor;
	/** Accumulator for per-call metrics (populated during execution) */
	llmCallAccumulator?: AccumulatedLlmCall[];
}

/**
 * Create observer hooks for LLM call logging.
 *
 * Returns an observers object that can be passed to .withHooks({ observers }).
 */
export function createObserverHooks(config: ObserverHooksConfig) {
	const { model, logWriter, trackingContext, llmCallLogger } = config;

	// Track LLM call timing per iteration
	const llmCallStartTimes = new Map<number, number>();

	return {
		onLLMCallReady: async (context: ObserveLLMCallContext) => {
			if (context.subagentContext) return;

			// Check for loop pattern (compares previous iteration's calls with current)
			// This must happen BEFORE incrementing iteration so we compare the right data
			const loopDetected = checkForLoopAndAdvance(trackingContext);
			if (loopDetected) {
				logWriter('WARN', 'Loop detected', {
					iteration: context.iteration,
					repeatCount: trackingContext.loopDetection.repeatCount,
					pattern: trackingContext.loopDetection.repeatedPattern,
				});
			}

			// Track timing
			llmCallStartTimes.set(context.iteration, Date.now());

			// Log BEFORE the LLM call to cascade log file
			logWriter('INFO', 'LLM call starting', {
				iteration: context.iteration,
				model,
				messageCount: context.options.messages.length,
			});

			// File logging for debugging
			incrementLLMIteration(trackingContext);
			const callNumber = trackingContext.metrics.llmIterations;
			llmCallLogger.logRequest(callNumber, context.options.messages);

			// Feed iteration state to progress monitor (no posting — timer handles that)
			if (config.progressMonitor) {
				await config.progressMonitor.onIteration(callNumber, 0);
			}
		},

		onLLMCallComplete: async (context: ObserveLLMCompleteContext) => {
			if (context.subagentContext) return;

			// Calculate duration
			const startTime = llmCallStartTimes.get(context.iteration) ?? Date.now();
			const durationMs = Date.now() - startTime;
			llmCallStartTimes.delete(context.iteration);

			const callNumber = trackingContext.metrics.llmIterations;

			// Log metrics to cascade log file
			if (context.usage) {
				const cost = calculateCost(model, context.usage);
				logWriter('INFO', 'LLM call complete', {
					model,
					iteration: context.iteration,
					inputTokens: context.usage.inputTokens,
					outputTokens: context.usage.outputTokens,
					cachedTokens: context.usage.cachedInputTokens ?? 0,
					durationMs,
					cost: `$${cost.toFixed(6)}`,
				});

				// Accumulate per-call metrics for run tracking
				if (config.llmCallAccumulator) {
					config.llmCallAccumulator.push({
						callNumber,
						inputTokens: context.usage.inputTokens,
						outputTokens: context.usage.outputTokens,
						cachedTokens: context.usage.cachedInputTokens ?? 0,
						costUsd: cost,
						durationMs,
					});
				}
			}

			// File logging for debugging
			llmCallLogger.logResponse(callNumber, context.rawResponse as string);
		},

		onRateLimitThrottle: async (context: ObserveRateLimitThrottleContext) => {
			if (context.subagentContext) return;
			logWriter('INFO', 'Rate limit throttling', {
				iteration: context.iteration,
				delayMs: context.delayMs,
				triggeredBy: context.stats.triggeredBy,
			});
		},

		onRetryAttempt: async (context: ObserveRetryAttemptContext) => {
			if (context.subagentContext) return;
			logWriter('WARN', 'Retrying LLM call', {
				iteration: context.iteration,
				attempt: context.attemptNumber,
				retriesLeft: context.retriesLeft,
				error: context.error.message,
				retryAfterMs: context.retryAfterMs,
			});
		},
	};
}
