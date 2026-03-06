/**
 * File-based state bridge for sharing the progress comment ID between
 * the ProgressMonitor (which creates the initial comment) and the
 * PostComment gadget (which posts the final summary).
 *
 * Uses a state file `.cascade-progress-comment-id` written to the repo
 * working directory. This approach works for both the llmist backend
 * (same process) and the Claude Code backend (subprocess), since both
 * share the same filesystem.
 *
 * File format: `<workItemId>:<commentId>`
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const STATE_FILE_NAME = '.cascade-progress-comment-id';

/**
 * Writes the progress comment ID to the state file in the given repo directory.
 *
 * @param repoDir - The working directory where the state file will be written.
 * @param workItemId - The work item ID (Trello card ID or JIRA issue key).
 * @param commentId - The comment ID returned by addComment().
 */
export function writeProgressCommentId(
	repoDir: string,
	workItemId: string,
	commentId: string,
): void {
	const filePath = join(repoDir, STATE_FILE_NAME);
	writeFileSync(filePath, `${workItemId}:${commentId}`, 'utf-8');
}

/**
 * Reads the progress comment state from the state file.
 *
 * @param repoDir - Optional directory containing the state file. Defaults to
 *                  `process.cwd()` if not provided. For cross-process usage
 *                  (e.g., Claude Code subprocess), the caller should ensure
 *                  `process.chdir(repoDir)` has been called, or pass `repoDir`
 *                  explicitly.
 * @returns `{ workItemId, commentId }` if the state file exists and is valid,
 *          or `null` if not found or malformed.
 */
export function readProgressCommentId(
	repoDir?: string,
): { workItemId: string; commentId: string } | null {
	const dir = repoDir ?? process.cwd();
	const filePath = join(dir, STATE_FILE_NAME);

	if (!existsSync(filePath)) return null;

	try {
		const content = readFileSync(filePath, 'utf-8').trim();
		const colonIndex = content.indexOf(':');
		if (colonIndex === -1) return null;

		const workItemId = content.slice(0, colonIndex);
		const commentId = content.slice(colonIndex + 1);

		if (!workItemId || !commentId) return null;

		return { workItemId, commentId };
	} catch {
		return null;
	}
}

/**
 * Deletes the progress comment state file.
 *
 * @param repoDir - Optional directory containing the state file. Defaults to
 *                  `process.cwd()` if not provided.
 */
export function clearProgressCommentId(repoDir?: string): void {
	const dir = repoDir ?? process.cwd();
	const filePath = join(dir, STATE_FILE_NAME);

	if (existsSync(filePath)) {
		rmSync(filePath);
	}
}
