import type { TrailingMessage } from 'llmist';

/**
 * Get trailing message function for iteration tracking.
 *
 * Injects iteration budget awareness into each LLM call:
 * - Shows current iteration and remaining budget
 * - Adds urgency warnings when >80% through iterations
 * - Moderate reminders when >50% through iterations
 * - Minimal info when <50% through iterations
 *
 * Trailing messages are ephemeral - they appear in each request but don't
 * persist to conversation history, keeping context clean.
 *
 * @returns Trailing message function
 */
export function getIterationTrailingMessage(): TrailingMessage {
	return (ctx) => {
		const remaining = ctx.maxIterations - ctx.iteration;
		const percent = (ctx.iteration / ctx.maxIterations) * 100;

		if (percent > 80) {
			return `⚠️ ITERATION BUDGET: ${ctx.iteration}/${ctx.maxIterations} - Only ${remaining} remaining! Wrap up now.`;
		}

		if (percent > 50) {
			return `Iteration ${ctx.iteration}/${ctx.maxIterations} (${remaining} remaining)`;
		}

		return `Iteration ${ctx.iteration}/${ctx.maxIterations}`;
	};
}
