import type { RetryConfig } from 'llmist';
import type { ILogObj, Logger } from 'tslog';

/**
 * Get retry configuration with logging callbacks.
 *
 * Configures aggressive retry behavior for long-running agents:
 * - 5 retry attempts
 * - Exponential backoff (1s to 60s)
 * - Respects Retry-After headers
 * - Logs all retry attempts and failures
 *
 * @param logger - CASCADE logger for logging retry events
 * @returns Retry configuration
 */
export function getRetryConfig(logger: Logger<ILogObj>): RetryConfig {
	return {
		enabled: true,
		retries: 5, // Aggressive retry for long-running agents
		minTimeout: 1000, // 1 second initial
		maxTimeout: 60000, // Max 60 seconds
		factor: 2, // Exponential backoff
		randomize: true, // Jitter to prevent thundering herd
		respectRetryAfter: true, // Honor Retry-After headers
		maxRetryAfterMs: 120000, // Cap at 2 minutes

		onRetry: (error: Error, attempt: number) => {
			// Calculate the delay for this retry (exponential backoff with jitter)
			const baseDelay = Math.min(1000 * 2 ** (attempt - 1), 60000);
			logger.warn('LLM call retry', {
				attempt,
				maxAttempts: 5,
				error: error.message,
				nextRetryDelayMs: baseDelay,
			});
		},

		onRetriesExhausted: (error: Error, attempts: number) => {
			logger.error('LLM call failed after all retries exhausted', {
				attempts,
				error: error.message,
				totalWaitTimeMs: `~${1000 + 2000 + 4000 + 8000 + 16000}`, // Approximate total
			});
		},
	};
}
