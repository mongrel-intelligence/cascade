/**
 * Agent-specific emoji and label for progress update headers.
 *
 * Used by:
 * - progressModel.ts — LLM prompt to produce correct header
 * - statusUpdateConfig.ts — template fallback header
 */
export const AGENT_LABELS: Record<string, { emoji: string; label: string }> = {
	briefing: { emoji: '📋', label: 'Briefing Update' },
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
 * Human-readable initial messages per agent type.
 *
 * Used by:
 * - ProgressMonitor (worker-side) — initial comment on work item
 * - Router acknowledgments — immediate ack before worker starts
 */
export const INITIAL_MESSAGES: Record<string, string> = {
	briefing:
		'**📋 Analyzing brief** — Reading the card and gathering context to create a clear brief...',
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
