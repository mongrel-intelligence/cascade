import type { TrailingMessage } from 'llmist';

/**
 * Get trailing message function for iteration tracking.
 *
 * Injects iteration budget awareness into each LLM call:
 * - Always shows current iteration, remaining count, and percentage
 * - Adds urgency indicator when running low on iterations
 *
 * Trailing messages are ephemeral - they appear in each request but don't
 * persist to conversation history, keeping context clean.
 *
 * @returns Trailing message function
 */
export function getIterationTrailingMessage(): TrailingMessage {
	return (ctx) => {
		const remaining = ctx.maxIterations - ctx.iteration;
		const percent = Math.round((ctx.iteration / ctx.maxIterations) * 100);

		const batchReminder =
			'Output ALL gadget calls in this turn. CHAIN: EditFile + Tmux (verify after edits). BATCH: Fix ALL errors in ONE response, not one-by-one. NEVER mark acceptance criteria complete without passing verification.';

		if (percent >= 80) {
			return `🚨 Iteration ${ctx.iteration}/${ctx.maxIterations} (${percent}% used, ${remaining} remaining) - ${batchReminder}`;
		}

		if (percent >= 50) {
			return `⚠️ Iteration ${ctx.iteration}/${ctx.maxIterations} (${percent}% used, ${remaining} remaining) - ${batchReminder}`;
		}

		return `Iteration ${ctx.iteration}/${ctx.maxIterations} (${percent}% used, ${remaining} remaining) - ${batchReminder}`;
	};
}
