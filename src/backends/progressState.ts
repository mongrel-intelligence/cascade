/**
 * Env-var-based state bridge for sharing the progress comment ID between
 * the ProgressMonitor (which creates the initial comment) and the
 * PostComment gadget (which posts the final summary).
 *
 * Uses the `CASCADE_PROGRESS_COMMENT_ID` environment variable following
 * the existing `CASCADE_*` naming pattern. The env var format is
 * `<workItemId>:<commentId>`.
 *
 * For the pre-seeded case (~90% of runs), the env var is injected into
 * the Claude Code subprocess via `projectSecrets` before subprocess launch,
 * so it is available from startup. For the dynamic case (ProgressMonitor
 * `postInitial()`), `process.env` is updated in-process — same-process
 * consumers see it immediately; cross-process visibility is an accepted gap.
 */

export const ENV_VAR_NAME = 'CASCADE_PROGRESS_COMMENT_ID';

/**
 * Writes the progress comment ID to the env var.
 *
 * @param workItemId - The work item ID (Trello card ID or JIRA issue key).
 * @param commentId - The comment ID returned by addComment().
 */
export function writeProgressCommentId(workItemId: string, commentId: string): void {
	process.env[ENV_VAR_NAME] = `${workItemId}:${commentId}`;
}

/**
 * Reads the progress comment state from the env var.
 *
 * @returns `{ workItemId, commentId }` if the env var is set and valid,
 *          or `null` if not found or malformed.
 */
export function readProgressCommentId(): { workItemId: string; commentId: string } | null {
	const value = process.env[ENV_VAR_NAME];
	if (!value) return null;

	const colonIndex = value.indexOf(':');
	if (colonIndex === -1) return null;

	const workItemId = value.slice(0, colonIndex);
	const commentId = value.slice(colonIndex + 1);

	if (!workItemId || !commentId) return null;

	return { workItemId, commentId };
}

/**
 * Clears the progress comment state by deleting the env var.
 */
export function clearProgressCommentId(): void {
	delete process.env[ENV_VAR_NAME];
}
