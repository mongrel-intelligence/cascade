/**
 * GitHub Projects platform client for posting/deleting comments on issues/PRs
 * via the GitHub GraphQL API.
 */

import {
	addCommentToIssue,
	deleteComment,
	updateComment,
	withGitHubProjectsCredentials,
} from '../../github-projects/client.js';
import { logger } from '../../utils/logging.js';
import { resolveGitHubProjectsCredentials } from './credentials.js';
import type { PlatformCommentClient } from './types.js';

export class GitHubProjectsPlatformClient implements PlatformCommentClient {
	constructor(private readonly projectId: string) {}

	async postComment(workItemId: string, message: string): Promise<string | null> {
		const creds = await resolveGitHubProjectsCredentials(this.projectId);
		if (!creds) {
			logger.warn('[PlatformClient] Missing GitHub Projects credentials, skipping comment');
			return null;
		}

		try {
			const commentId = await withGitHubProjectsCredentials({ token: creds.token }, () =>
				addCommentToIssue(workItemId, message),
			);
			logger.info('[PlatformClient] GitHub Projects comment posted for item:', workItemId);
			return commentId;
		} catch (err) {
			logger.warn('[PlatformClient] Failed to post GitHub Projects comment:', String(err));
			return null;
		}
	}

	async deleteComment(workItemId: string, commentId: string | number): Promise<void> {
		const creds = await resolveGitHubProjectsCredentials(this.projectId);
		if (!creds) return;

		try {
			await withGitHubProjectsCredentials({ token: creds.token }, () =>
				deleteComment(String(commentId)),
			);
			logger.info('[PlatformClient] GitHub Projects comment deleted:', { workItemId, commentId });
		} catch (err) {
			logger.warn('[PlatformClient] Failed to delete GitHub Projects comment:', String(err));
		}
	}

	async updateComment(workItemId: string, commentId: string, message: string): Promise<void> {
		const creds = await resolveGitHubProjectsCredentials(this.projectId);
		if (!creds) return;

		try {
			await withGitHubProjectsCredentials({ token: creds.token }, () =>
				updateComment(commentId, message),
			);
			logger.info('[PlatformClient] GitHub Projects comment updated:', { workItemId, commentId });
		} catch (err) {
			logger.warn('[PlatformClient] Failed to update GitHub Projects comment:', String(err));
		}
	}
}
