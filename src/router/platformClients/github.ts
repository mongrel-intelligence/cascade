/**
 * GitHub platform client for posting/deleting PR/issue comments via the GitHub REST API.
 */

import { logger } from '../../utils/logging.js';
import { resolveGitHubHeaders } from './credentials.js';
import type { PlatformCommentClient } from './types.js';

export class GitHubPlatformClient implements PlatformCommentClient {
	constructor(
		private readonly repoFullName: string,
		private readonly token: string,
	) {}

	async postComment(prNumber: string | number, message: string): Promise<number | null> {
		try {
			const url = `https://api.github.com/repos/${this.repoFullName}/issues/${prNumber}/comments`;
			const response = await fetch(url, {
				method: 'POST',
				headers: resolveGitHubHeaders(this.token, { 'Content-Type': 'application/json' }),
				body: JSON.stringify({ body: message }),
			});

			if (!response.ok) {
				logger.warn(
					'[PlatformClient] GitHub comment failed:',
					response.status,
					await response.text(),
				);
				return null;
			}

			const data = (await response.json()) as { id?: number };
			logger.info('[PlatformClient] GitHub comment posted for PR:', prNumber);
			return data.id ?? null;
		} catch (err) {
			logger.warn('[PlatformClient] Failed to post GitHub comment:', String(err));
			return null;
		}
	}

	async deleteComment(_target: string, commentId: number): Promise<void> {
		const url = `https://api.github.com/repos/${this.repoFullName}/issues/comments/${commentId}`;
		try {
			await fetch(url, {
				method: 'DELETE',
				headers: resolveGitHubHeaders(this.token),
			});
			logger.info('[PlatformClient] GitHub comment deleted:', commentId);
		} catch (err) {
			logger.warn('[PlatformClient] Failed to delete GitHub comment:', String(err));
		}
	}
}
