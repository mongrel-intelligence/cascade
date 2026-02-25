/**
 * Agent-specific emoji and label for progress update headers.
 *
 * Used by:
 * - progressModel.ts — LLM prompt to produce correct header
 * - statusUpdateConfig.ts — template fallback header
 */
export const AGENT_LABELS: Record<string, { emoji: string; label: string }> = {
	splitting: { emoji: '📋', label: 'Splitting Update' },
	planning: { emoji: '🗺️', label: 'Planning Update' },
	implementation: { emoji: '🧑‍💻', label: 'Implementation Update' },
	review: { emoji: '🔍', label: 'Code Review Update' },
	'respond-to-planning-comment': { emoji: '💬', label: 'Planning Response Update' },
	'respond-to-review': { emoji: '🔧', label: 'Review Response Update' },
	'respond-to-pr-comment': { emoji: '💬', label: 'PR Comment Response Update' },
	'respond-to-ci': { emoji: '🔧', label: 'CI Fix Update' },
	debug: { emoji: '🐛', label: 'Debug Update' },
};

/**
 * Get the emoji and label for a given agent type.
 * Falls back to a generic label for unknown agent types.
 */
export function getAgentLabel(agentType: string): { emoji: string; label: string } {
	return AGENT_LABELS[agentType] ?? { emoji: '⚙️', label: 'Progress Update' };
}

/**
 * Agent role hints — give LLMs context about what each agent type does.
 *
 * Used by:
 * - ackMessageGenerator.ts — contextual acknowledgment messages
 * - progressModel.ts — progress update generation
 */
export const AGENT_ROLE_HINTS: Record<string, string> = {
	splitting: 'Breaks down a feature plan into smaller, ordered work items (subtasks)',
	planning: 'Studies the codebase and designs a step-by-step implementation plan',
	implementation: 'Writes code, runs tests, and prepares a pull request',
	review: 'Reviews pull request changes for quality and correctness',
	'respond-to-planning-comment': 'Reads user feedback and updates the plan accordingly',
	'respond-to-review': 'Addresses code review feedback by making requested changes',
	'respond-to-pr-comment': 'Reads a PR comment and takes action',
	'respond-to-ci': 'Analyzes failed CI checks and works on a fix',
	debug: 'Analyzes session logs to identify what went wrong',
};

/**
 * Human-readable initial messages per agent type.
 *
 * Used by:
 * - ProgressMonitor (worker-side) — initial comment on work item
 * - Router acknowledgments — immediate ack before worker starts
 */
export const INITIAL_MESSAGES: Record<string, string> = {
	splitting: '**📋 Splitting plan** — Reading the plan and splitting it into ordered work items...',
	planning:
		'**🗺️ Planning implementation** — Studying the codebase and designing a step-by-step plan...',
	implementation:
		'**🚀 Implementing changes** — Writing code, running tests, and preparing a PR...',
	review: '**🔍 Reviewing code** — Examining the PR changes for quality and correctness...',
	'respond-to-planning-comment':
		'**💬 Responding to feedback** — Reading your comment and updating the plan accordingly...',
	'respond-to-review':
		'**🔧 Addressing review feedback** — Making the requested changes from the code review...',
	'respond-to-pr-comment':
		'**💬 Responding to PR comment** — Reading your comment and taking action...',
	'respond-to-ci':
		'**🔧 Fixing CI failures** — Analyzing the failed checks and working on a fix...',
	debug: '**🐛 Analyzing session logs** — Reviewing what happened and identifying issues...',
};
