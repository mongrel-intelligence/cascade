/**
 * Shared types for the platform client abstraction layer.
 */

import type { JiraCredentials } from '../../jira/types.js';

export type { TrelloCredentials } from '../../trello/types.js';

/** Extends JiraCredentials with a pre-computed Base64 Basic auth header value. */
export interface JiraCredentialsWithAuth extends JiraCredentials {
	/** Pre-computed Base64 Basic auth value: `email:apiToken` */
	auth: string;

	/**
	 * Optional JIRA authentication mode carried from the project config so the
	 * router platform client can select the effective REST host.
	 *
	 * - `'basic'` / absent — classic site-token mode; REST calls hit the tenant
	 *   site URL (`baseUrl`).
	 * - `'scoped'` — scoped gateway-token mode; v3/v2 REST comment calls route
	 *   through the Atlassian gateway (`https://api.atlassian.com/ex/jira/{cloudId}`).
	 *
	 * Both modes still authenticate via HTTP Basic `email:api_token` — the enum
	 * selects the host, not the auth scheme (confirmed live in MNG-1735).
	 * Redeclared from {@link JiraCredentials} to document its host-selection role
	 * at the platform-client boundary.
	 */
	authType?: 'basic' | 'scoped';
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
