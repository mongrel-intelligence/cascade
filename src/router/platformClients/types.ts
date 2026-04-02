/**
 * Shared types for the platform client abstraction layer.
 */

import type { JiraCredentials } from '../../jira/types.js';

export type { TrelloCredentials } from '../../trello/types.js';

/** Extends JiraCredentials with a pre-computed Base64 Basic auth header value. */
export interface JiraCredentialsWithAuth extends JiraCredentials {
	/** Pre-computed Base64 Basic auth value: `email:apiToken` */
	auth: string;
}

/**
 * Unified interface for posting and deleting comments and reactions across
 * GitHub and JIRA.  Implementations are fire-and-forget safe — they never
 * throw; all errors (including network failures) are caught and logged internally.
 */
export interface PlatformCommentClient {
	/**
	 * Post a comment.  Returns the new comment's ID (string or number) on
	 * success, or `null` on any failure.
	 */
	postComment(target: string, message: string): Promise<string | number | null>;

	/**
	 * Delete a previously-posted comment by ID.
	 * Silently returns on missing credentials or any failure.
	 */
	deleteComment(target: string, commentId: string | number): Promise<void>;

	/**
	 * Post a reaction on a comment / action.
	 * Silently returns on missing credentials or any failure.
	 */
	postReaction?(target: string, reactionPayload: unknown): Promise<void>;
}
