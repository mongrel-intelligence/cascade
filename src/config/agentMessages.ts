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
