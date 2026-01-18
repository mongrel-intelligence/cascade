import type { TrailingMessage } from 'llmist';
import { formatTodoList, loadTodos } from '../gadgets/todo/storage.js';

/**
 * Agent-specific batch hints.
 * Each agent type gets guidance relevant to its available gadgets.
 */
const AGENT_HINTS: Record<string, string> = {
	// Agents with file editing capabilities
	implementation:
		'Complete the current todo in as few iterations as possible. Batch related edits together. Verify with Tmux after edits. NEVER mark acceptance criteria complete without passing verification.',
	'respond-to-review':
		'Address the current review comment fully before moving to the next. Batch related file edits together.',

	// Read-only agents
	review:
		'Focus on the current aspect of review before moving to the next. Read related files together.',
	briefing: 'Gather all context needed for the current step before proceeding.',
	planning: 'Complete the current planning step efficiently before moving to the next.',
	debug: 'Analyze the current issue fully before moving to the next.',

	// Default fallback
	default: 'Complete the current task efficiently before moving to the next.',
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
 * Format the iteration status line with appropriate urgency indicator.
 */
function formatIterationStatus(
	iteration: number,
	maxIterations: number,
	batchHint: string,
): string {
	const remaining = maxIterations - iteration;
	const percent = Math.round((iteration / maxIterations) * 100);

	if (percent >= 80) {
		return `🚨 Iteration ${iteration}/${maxIterations} (${percent}% used, ${remaining} remaining) - ${batchHint}`;
	}

	if (percent >= 50) {
		return `⚠️ Iteration ${iteration}/${maxIterations} (${percent}% used, ${remaining} remaining) - ${batchHint}`;
	}

	return `Iteration ${iteration}/${maxIterations} (${percent}% used, ${remaining} remaining) - ${batchHint}`;
}

/**
 * Get trailing message function for iteration tracking.
 *
 * Injects iteration budget awareness into each LLM call:
 * - Always shows current iteration, remaining count, and percentage
 * - Adds urgency indicator when running low on iterations
 * - Includes agent-specific batch processing hints
 * - For implementation agent: includes current todo list for visibility
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
		const iterationStatus = formatIterationStatus(ctx.iteration, ctx.maxIterations, batchHint);

		// For implementation agent, include the current todo list
		if (agentType === 'implementation') {
			const todos = loadTodos();
			if (todos.length > 0) {
				const todoListFormatted = formatTodoList(todos);
				return `${iterationStatus}\n\n## Current Progress\n\n${todoListFormatted}`;
			}
		}

		return iterationStatus;
	};
}
