/**
 * GitHub PR progress comment poster.
 *
 * Updates the initial PR comment with AI-generated progress summaries.
 * Reads the session state to find the initial comment ID, formats the
 * GitHub progress comment, and updates it via the GitHub client.
 */

import { formatGitHubProgressComment } from '../../config/statusUpdateConfig.js';
import { getSessionState } from '../../gadgets/sessionState.js';
import { githubClient } from '../../github/client.js';
import type { LogWriter } from '../types.js';

export interface GitHubProgressPosterConfig {
	owner: string;
	repo: string;
	headerMessage: string;
	logWriter: LogWriter;
}

export class GitHubProgressPoster {
	constructor(private readonly config: GitHubProgressPosterConfig) {}

	async update(summary: string, agentType: string): Promise<void> {
		const { initialCommentId } = getSessionState();
		if (!initialCommentId) return;

		const body = formatGitHubProgressComment(this.config.headerMessage, agentType);
		// Replace the todo section with the AI-generated summary
		const bodyWithSummary = body.replace(/\n\n📋[\s\S]*?\n\n/, `\n\n${summary}\n\n`);
		await githubClient.updatePRComment(
			this.config.owner,
			this.config.repo,
			initialCommentId,
			bodyWithSummary,
		);
		this.config.logWriter('INFO', 'Updated GitHub PR comment with progress', {
			commentId: initialCommentId,
		});
	}
}
