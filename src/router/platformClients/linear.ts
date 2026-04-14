/**
 * Linear platform client for posting/deleting comments on Linear issues
 * via the Linear GraphQL API.
 *
 * Comments are posted using the Linear GraphQL API with markdown body text.
 */

import { logger } from '../../utils/logging.js';
import { resolveLinearCredentials } from './credentials.js';
import type { PlatformCommentClient } from './types.js';

const LINEAR_API_URL = 'https://api.linear.app/graphql';

async function linearGraphQL(
	apiKey: string,
	query: string,
	variables?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const response = await fetch(LINEAR_API_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({ query, variables }),
	});

	if (!response.ok) {
		throw new Error(`Linear API HTTP error ${response.status}`);
	}

	const json = (await response.json()) as {
		data?: Record<string, unknown>;
		errors?: Array<{ message: string }>;
	};

	if (json.errors && json.errors.length > 0) {
		const messages = json.errors.map((e) => e.message).join('; ');
		throw new Error(`Linear API error: ${messages}`);
	}

	return json.data ?? {};
}

export class LinearPlatformClient implements PlatformCommentClient {
	constructor(private readonly projectId: string) {}

	async postComment(issueId: string, message: string): Promise<string | null> {
		const creds = await resolveLinearCredentials(this.projectId);
		if (!creds) {
			logger.warn('[PlatformClient] Missing Linear credentials, skipping comment');
			return null;
		}

		try {
			const mutation = `
				mutation CreateComment($issueId: String!, $body: String!) {
					commentCreate(input: { issueId: $issueId, body: $body }) {
						success
						comment {
							id
						}
					}
				}
			`;

			const data = await linearGraphQL(creds.apiKey, mutation, {
				issueId,
				body: message,
			});

			const commentCreate = data.commentCreate as
				| { success: boolean; comment?: { id: string } }
				| undefined;

			if (!commentCreate?.success) {
				logger.warn('[PlatformClient] Linear commentCreate returned success=false');
				return null;
			}

			const commentId = commentCreate.comment?.id ?? null;
			logger.info('[PlatformClient] Linear comment posted for issue:', issueId);
			return commentId;
		} catch (err) {
			logger.warn('[PlatformClient] Failed to post Linear comment:', String(err));
			return null;
		}
	}

	async deleteComment(_issueId: string, commentId: string | number): Promise<void> {
		const creds = await resolveLinearCredentials(this.projectId);
		if (!creds) return;

		try {
			const mutation = `
				mutation DeleteComment($commentId: String!) {
					commentDelete(id: $commentId) {
						success
					}
				}
			`;

			await linearGraphQL(creds.apiKey, mutation, {
				commentId: String(commentId),
			});

			logger.info('[PlatformClient] Linear comment deleted:', commentId);
		} catch (err) {
			logger.warn('[PlatformClient] Failed to delete Linear comment:', String(err));
		}
	}

	async updateComment(commentId: string, message: string): Promise<void> {
		const creds = await resolveLinearCredentials(this.projectId);
		if (!creds) return;

		try {
			const mutation = `
				mutation UpdateComment($commentId: String!, $body: String!) {
					commentUpdate(id: $commentId, input: { body: $body }) {
						success
					}
				}
			`;

			await linearGraphQL(creds.apiKey, mutation, {
				commentId,
				body: message,
			});

			logger.info('[PlatformClient] Linear comment updated:', commentId);
		} catch (err) {
			logger.warn('[PlatformClient] Failed to update Linear comment:', String(err));
		}
	}
}
