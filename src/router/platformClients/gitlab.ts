/**
 * GitLab platform client for MR note (comment) operations.
 *
 * Uses raw `fetch()` against the GitLab REST API — the router Docker image
 * does not bundle heavy SDK dependencies.
 */

import { logger } from '../../utils/logging.js';

export class GitLabPlatformClient {
	constructor(
		private readonly projectPath: string,
		private readonly token: string,
		private readonly host: string = 'https://gitlab.com',
	) {}

	async postComment(mrIid: number, message: string): Promise<number | null> {
		try {
			const encodedPath = encodeURIComponent(this.projectPath);
			const url = `${this.host}/api/v4/projects/${encodedPath}/merge_requests/${mrIid}/notes`;
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'PRIVATE-TOKEN': this.token,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ body: message }),
			});
			if (!response.ok) {
				logger.warn('GitLab postComment failed', { status: response.status });
				return null;
			}
			const data = (await response.json()) as Record<string, unknown>;
			return data.id as number;
		} catch (err) {
			logger.warn('GitLab postComment error', { error: String(err) });
			return null;
		}
	}

	async deleteComment(mrIid: number, noteId: number): Promise<void> {
		try {
			const encodedPath = encodeURIComponent(this.projectPath);
			const url = `${this.host}/api/v4/projects/${encodedPath}/merge_requests/${mrIid}/notes/${noteId}`;
			await fetch(url, {
				method: 'DELETE',
				headers: { 'PRIVATE-TOKEN': this.token },
			});
		} catch (err) {
			logger.warn('GitLab deleteComment error', { error: String(err) });
		}
	}
}
