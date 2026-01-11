import type { TrailingMessage } from 'llmist';

/**
 * Agent-specific batch hints.
 * Each agent type gets guidance relevant to its available gadgets.
 */
const AGENT_HINTS: Record<string, string> = {
	// Agents with file editing capabilities
	implementation:
		'CHAIN: EditFile + Tmux (verify after edits). BATCH: Fix ALL errors in ONE response, not one-by-one. NEVER mark acceptance criteria complete without passing verification. When completing a task, immediately start the next one in the SAME response - never respond with only todo/checklist updates.',
	'respond-to-review':
		'CHAIN: EditFile + Tmux (verify after edits). BATCH: Address ALL review comments in ONE response.',

	// Read-only agents
	review:
		'BATCH: Read ALL relevant files in ONE response using ReadFile. Explore thoroughly before submitting review. When completing a task, immediately start the next one in the SAME response - never respond with only todo/checklist updates.',
	briefing: 'BATCH: Gather ALL context from card and codebase in ONE response.',
	planning: 'BATCH: Analyze ALL requirements and explore codebase thoroughly in ONE response.',
	debug: 'BATCH: Read and analyze ALL relevant logs in ONE response.',

	// Default fallback
	default:
		'BATCH: Complete as much as possible in each response. Output ALL gadget calls in this turn.',
};

/**
 * Get the agent-specific hint for batch processing.
 */
function getAgentHint(agentType?: string): string {
	if (agentType && agentType in AGENT_HINTS) {
		return AGENT_HINTS[agentType];
	}
	return AGENT_HINTS.default;
}

/**
 * Get trailing message function for iteration tracking.
 *
 * Injects iteration budget awareness into each LLM call:
 * - Always shows current iteration, remaining count, and percentage
 * - Adds urgency indicator when running low on iterations
 * - Includes agent-specific batch processing hints
 *
 * Trailing messages are ephemeral - they appear in each request but don't
 * persist to conversation history, keeping context clean.
 *
 * @param agentType - The type of agent (e.g., 'implementation', 'review')
 * @returns Trailing message function
 */
export function getIterationTrailingMessage(agentType?: string): TrailingMessage {
	const batchHint = getAgentHint(agentType);

	return (ctx) => {
		const remaining = ctx.maxIterations - ctx.iteration;
		const percent = Math.round((ctx.iteration / ctx.maxIterations) * 100);

		if (percent >= 80) {
			return `🚨 Iteration ${ctx.iteration}/${ctx.maxIterations} (${percent}% used, ${remaining} remaining) - ${batchHint}`;
		}

		if (percent >= 50) {
			return `⚠️ Iteration ${ctx.iteration}/${ctx.maxIterations} (${percent}% used, ${remaining} remaining) - ${batchHint}`;
		}

		return `Iteration ${ctx.iteration}/${ctx.maxIterations} (${percent}% used, ${remaining} remaining) - ${batchHint}`;
	};
}
