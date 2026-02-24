/**
 * Trello platform client for posting/deleting comments via the Trello REST API.
 */

import { logger } from '../../utils/logging.js';
import { resolveTrelloCredentials } from './credentials.js';
import type { PlatformCommentClient } from './types.js';

export class TrelloPlatformClient implements PlatformCommentClient {
	constructor(private readonly projectId: string) {}

	async postComment(cardId: string, message: string): Promise<string | null> {
		const creds = await resolveTrelloCredentials(this.projectId);
		if (!creds) {
			logger.warn('[PlatformClient] Missing Trello credentials, skipping comment');
			return null;
		}

		try {
			const url = `https://api.trello.com/1/cards/${cardId}/actions/comments?key=${creds.apiKey}&token=${creds.token}`;
			const response = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text: message }),
			});

			if (!response.ok) {
				logger.warn(
					'[PlatformClient] Trello comment failed:',
					response.status,
					await response.text(),
				);
				return null;
			}

			const data = (await response.json()) as { id?: string };
			logger.info('[PlatformClient] Trello comment posted for card:', cardId);
			return data.id ?? null;
		} catch (err) {
			logger.warn('[PlatformClient] Failed to post Trello comment:', String(err));
			return null;
		}
	}

	async deleteComment(cardId: string, commentId: string): Promise<void> {
		const creds = await resolveTrelloCredentials(this.projectId);
		if (!creds) return;

		const url = `https://api.trello.com/1/cards/${cardId}/actions/${commentId}/comments?key=${creds.apiKey}&token=${creds.token}`;
		try {
			await fetch(url, { method: 'DELETE' });
			logger.info('[PlatformClient] Trello comment deleted:', commentId);
		} catch (err) {
			logger.warn('[PlatformClient] Failed to delete Trello comment:', String(err));
		}
	}
}
