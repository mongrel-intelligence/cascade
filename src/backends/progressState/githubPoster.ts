/**
 * GitHub PR progress comment poster.
 *
 * Updates the initial PR comment with AI-generated progress summaries.
 * Reads the session state to find the initial comment ID, and replaces
 * the comment body entirely with the AI-generated summary.
 */

import { getSessionState } from '../../gadgets/sessionState.js';
import { githubClient } from '../../github/client.js';
import type { LogWriter } from '../types.js';

export interface GitHubProgressPosterConfig {
	owner: string;
	repo: string;
	logWriter: LogWriter;
}

export class GitHubProgressPoster {
	constructor(private readonly config: GitHubProgressPosterConfig) {}

	async update(summary: string): Promise<void> {
		const { initialCommentId } = getSessionState();
		if (!initialCommentId) return;

		await githubClient.updatePRComment(
			this.config.owner,
			this.config.repo,
			initialCommentId,
			summary,
		);
		this.config.logWriter('INFO', 'Updated GitHub PR comment with progress', {
			commentId: initialCommentId,
		});
	}
}
