/**
 * Returns Tailwind color classes for a tool/gadget name badge.
 * Used by both the LLM call list row and the call detail panel.
 */
export function getToolStyle(name: string): { bg: string; text: string } {
	// Read-like: file reads, searches, work item fetching
	if (/^(Read|Glob|Grep|LS|ReadWorkItem|ReadFile|FetchWorkItem)$/.test(name))
		return { bg: 'bg-sky-100 dark:bg-sky-900/30', text: 'text-sky-700 dark:text-sky-400' };
	// Bash-like: shell execution, tmux sessions
	if (/^(Bash|Shell|Tmux|RunCommand|Exec)$/.test(name))
		return { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-400' };
	// Write-like: file writes, task/todo mutations
	if (
		/^(Write|Edit|Create|NotebookEdit|TodoUpsert|TodoUpdateStatus|WriteFile|CreateFile|UpdateWorkItem|PostComment|AddComment)$/.test(
			name,
		)
	)
		return {
			bg: 'bg-emerald-100 dark:bg-emerald-900/30',
			text: 'text-emerald-700 dark:text-emerald-400',
		};
	// Web/external: network requests, agent spawning, messaging
	if (/^(WebFetch|WebSearch|Agent|SendMessage|Fetch|HttpRequest)$/.test(name))
		return {
			bg: 'bg-violet-100 dark:bg-violet-900/30',
			text: 'text-violet-700 dark:text-violet-400',
		};
	return { bg: 'bg-muted', text: 'text-muted-foreground' };
}
