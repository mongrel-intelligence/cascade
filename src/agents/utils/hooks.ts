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

import {
	formatGitHubProgressComment,
	formatStatusMessage,
	getStatusUpdateConfig,
} from '../../config/statusUpdateConfig.js';
import { getSessionState } from '../../gadgets/sessionState.js';
import { githubClient } from '../../github/client.js';
import { trelloClient } from '../../trello/client.js';
import type { LLMCallLogger } from '../../utils/llmLogging.js';
import { calculateCost } from '../../utils/llmMetrics.js';
import { syncCompletedTodosToChecklist } from './checklistSync.js';
import { type TrackingContext, checkForLoopAndAdvance, incrementLLMIteration } from './tracking.js';

/** Function signature for writing to cascade log file */
export type LogWriter = (level: string, message: string, context?: Record<string, unknown>) => void;

/** Configuration for status update feature */
export interface StatusUpdateHooksConfig {
	/** Trello card ID to post updates to */
	cardId: string;
	/** Agent type for formatting */
	agentType: string;
	/** Maximum iterations for progress calculation */
	maxIterations: number;
}

/** Configuration for GitHub PR comment progress updates */
export interface GitHubProgressHooksConfig {
	/** GitHub repository owner */
	owner: string;
	/** GitHub repository name */
	repo: string;
	/** Original comment text to preserve as header */
	headerMessage: string;
	/** Agent type for formatting */
	agentType: string;
	/** Maximum iterations for progress calculation */
	maxIterations: number;
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
	/** Optional status update configuration */
	statusUpdate?: StatusUpdateHooksConfig;
	/** Optional GitHub PR comment progress configuration */
	githubProgress?: GitHubProgressHooksConfig;
}

/**
 * Post a status update to Trello and optionally sync checklist items.
 * Extracted from onLLMCallReady to reduce cognitive complexity.
 */
async function postStatusUpdate(
	config: StatusUpdateHooksConfig,
	iteration: number,
	logWriter: LogWriter,
): Promise<void> {
	const { cardId, agentType, maxIterations } = config;
	const statusConfig = getStatusUpdateConfig(agentType);

	if (
		!statusConfig.enabled ||
		iteration === 0 ||
		iteration % statusConfig.intervalIterations !== 0
	) {
		return;
	}

	try {
		// Post status comment
		const message = formatStatusMessage(iteration, maxIterations, agentType);
		await trelloClient.addComment(cardId, message);
		logWriter('INFO', 'Posted status update to Trello', { iteration, cardId });

		// For implementation agent: sync completed TODOs to checklist
		if (agentType === 'implementation') {
			await syncCompletedTodosToChecklist(cardId);
		}
	} catch (err) {
		logWriter('WARN', 'Failed to post status update', {
			iteration,
			cardId,
			error: String(err),
		});
	}
}

/**
 * Post a progress update to a GitHub PR comment.
 * Updates the initial comment with current progress bar and todo list.
 */
async function postGitHubProgressUpdate(
	config: GitHubProgressHooksConfig,
	iteration: number,
	logWriter: LogWriter,
): Promise<void> {
	const { owner, repo, headerMessage, agentType, maxIterations } = config;
	const statusConfig = getStatusUpdateConfig(agentType);

	if (
		!statusConfig.enabled ||
		iteration === 0 ||
		iteration % statusConfig.intervalIterations !== 0
	) {
		return;
	}

	const { initialCommentId } = getSessionState();
	if (!initialCommentId) {
		logWriter('WARN', 'No initial comment ID found, skipping GitHub progress update', {
			iteration,
		});
		return;
	}

	try {
		const body = formatGitHubProgressComment(headerMessage, iteration, maxIterations, agentType);
		await githubClient.updatePRComment(owner, repo, initialCommentId, body);
		logWriter('INFO', 'Updated GitHub PR comment with progress', {
			iteration,
			commentId: initialCommentId,
		});
	} catch (err) {
		logWriter('WARN', 'Failed to update GitHub PR comment with progress', {
			iteration,
			commentId: initialCommentId,
			error: String(err),
		});
	}
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

			// Post periodic status updates to Trello
			if (config.statusUpdate) {
				await postStatusUpdate(config.statusUpdate, callNumber, logWriter);
			}

			// Post periodic progress updates to GitHub PR comment
			if (config.githubProgress) {
				await postGitHubProgressUpdate(config.githubProgress, callNumber, logWriter);
			}
		},

		onLLMCallComplete: async (context: ObserveLLMCompleteContext) => {
			if (context.subagentContext) return;

			// Calculate duration
			const startTime = llmCallStartTimes.get(context.iteration) ?? Date.now();
			const durationMs = Date.now() - startTime;
			llmCallStartTimes.delete(context.iteration);

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
			}

			// File logging for debugging
			const callNumber = trackingContext.metrics.llmIterations;
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
