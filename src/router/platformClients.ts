/**
 * Shared credential resolution and platform API header helpers for router modules.
 *
 * Resolves credentials once per call and returns typed objects.
 * Callers use raw `fetch()` — the router Docker image does not bundle
 * `src/trello/client.ts` or `src/github/client.ts`.
 *
 * Also exports `PlatformCommentClient` — a unified abstraction that eliminates
 * the repeated "resolve creds → build URL → fetch → log" pattern across
 * acknowledgments.ts, notifications.ts, and reactions.ts.
 */

import { findProjectById, getIntegrationCredential } from '../config/provider.js';
import { getJiraConfig } from '../pm/config.js';
import { logger } from '../utils/logging.js';

// ---------------------------------------------------------------------------
// Credential resolution helpers
// ---------------------------------------------------------------------------

export interface TrelloCredentials {
	apiKey: string;
	token: string;
}

export interface JiraCredentials {
	email: string;
	apiToken: string;
	baseUrl: string;
	/** Pre-computed Base64 Basic auth value: `email:apiToken` */
	auth: string;
}

/**
 * Resolve Trello credentials for a project.
 * Returns `{ apiKey, token }` or `null` if credentials are missing.
 */
export async function resolveTrelloCredentials(
	projectId: string,
): Promise<TrelloCredentials | null> {
	try {
		const apiKey = await getIntegrationCredential(projectId, 'pm', 'api_key');
		const token = await getIntegrationCredential(projectId, 'pm', 'token');
		return { apiKey, token };
	} catch {
		return null;
	}
}

/**
 * Resolve JIRA credentials for a project.
 * Returns `{ email, apiToken, baseUrl, auth }` or `null` if credentials/config are missing.
 * The `auth` field is the pre-computed Base64 Basic auth string.
 */
export async function resolveJiraCredentials(projectId: string): Promise<JiraCredentials | null> {
	try {
		const email = await getIntegrationCredential(projectId, 'pm', 'email');
		const apiToken = await getIntegrationCredential(projectId, 'pm', 'api_token');
		const project = await findProjectById(projectId);
		const baseUrl = (project ? getJiraConfig(project)?.baseUrl : undefined) ?? '';
		if (!baseUrl) throw new Error('Missing JIRA base URL');
		const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
		return { email, apiToken, baseUrl, auth };
	} catch {
		return null;
	}
}

/**
 * Build standard GitHub API request headers for a given token.
 * Used in place of the 6+ inline header objects scattered across router files.
 */
export function resolveGitHubHeaders(
	token: string,
	extra?: Record<string, string>,
): Record<string, string> {
	return {
		Authorization: `Bearer ${token}`,
		Accept: 'application/vnd.github+json',
		'X-GitHub-Api-Version': '2022-11-28',
		...extra,
	};
}

// ---------------------------------------------------------------------------
// PlatformCommentClient — unified abstraction for cross-platform comments
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// GitHubPlatformClient
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// JiraPlatformClient
// ---------------------------------------------------------------------------

/** In-memory JIRA CloudId cache keyed by baseUrl */
const _jiraCloudIdCache = new Map<string, string>();

/** @internal Visible for testing only */
export function _resetJiraCloudIdCache(): void {
	_jiraCloudIdCache.clear();
}

export class JiraPlatformClient implements PlatformCommentClient {
	constructor(private readonly projectId: string) {}

	async postComment(issueKey: string, message: string): Promise<string | null> {
		const creds = await resolveJiraCredentials(this.projectId);
		if (!creds) {
			logger.warn('[PlatformClient] Missing JIRA credentials, skipping comment');
			return null;
		}

		try {
			const url = `${creds.baseUrl}/rest/api/2/issue/${issueKey}/comment`;
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					Authorization: `Basic ${creds.auth}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ body: message }),
			});

			if (!response.ok) {
				logger.warn(
					'[PlatformClient] JIRA comment failed:',
					response.status,
					await response.text(),
				);
				return null;
			}

			const data = (await response.json()) as { id?: string };
			logger.info('[PlatformClient] JIRA comment posted for issue:', issueKey);
			return data.id ?? null;
		} catch (err) {
			logger.warn('[PlatformClient] Failed to post JIRA comment:', String(err));
			return null;
		}
	}

	async deleteComment(issueKey: string, commentId: string): Promise<void> {
		const creds = await resolveJiraCredentials(this.projectId);
		if (!creds) return;

		const url = `${creds.baseUrl}/rest/api/2/issue/${issueKey}/comment/${commentId}`;
		try {
			await fetch(url, {
				method: 'DELETE',
				headers: {
					Authorization: `Basic ${creds.auth}`,
					'Content-Type': 'application/json',
				},
			});
			logger.info('[PlatformClient] JIRA comment deleted:', commentId);
		} catch (err) {
			logger.warn('[PlatformClient] Failed to delete JIRA comment:', String(err));
		}
	}

	/**
	 * Post a JIRA reactions-API reaction on a comment.
	 * `target` is ignored (cloudId is resolved internally from credentials).
	 * `reactionPayload` is `{ issueId, commentId }`.
	 */
	async postReaction(
		_target: string,
		reactionPayload: { issueId: string; commentId: string },
	): Promise<void> {
		const creds = await resolveJiraCredentials(this.projectId);
		if (!creds) {
			logger.warn('[PlatformClient] Missing JIRA credentials, skipping reaction');
			return;
		}

		const cloudId = await this._getCloudId(creds.baseUrl, creds.auth);
		if (!cloudId) return;

		try {
			const { issueId, commentId } = reactionPayload;
			const emojiId = 'atlassian-thought_balloon';
			const ari = `ari%3Acloud%3Ajira%3A${cloudId}%3Acomment%2F${issueId}%2F${commentId}`;
			const reactionsUrl = `${creds.baseUrl}/rest/reactions/1.0/reactions/${ari}/${emojiId}`;

			const reactionResponse = await fetch(reactionsUrl, {
				method: 'PUT',
				headers: {
					Authorization: `Basic ${creds.auth}`,
					'Content-Type': 'application/json',
				},
			});

			if (reactionResponse.ok) {
				logger.info('[PlatformClient] JIRA reaction sent for comment:', commentId);
			} else {
				logger.warn(
					'[PlatformClient] JIRA reactions API failed:',
					reactionResponse.status,
					'— skipping (no fallback to avoid webhook loops)',
				);
			}
		} catch (err) {
			logger.warn('[PlatformClient] Failed to post JIRA reaction:', String(err));
		}
	}

	private async _getCloudId(baseUrl: string, auth: string): Promise<string | null> {
		const cached = _jiraCloudIdCache.get(baseUrl);
		if (cached) return cached;

		let response: Response;
		try {
			response = await fetch(`${baseUrl}/_edge/tenant_info`, {
				headers: { Authorization: `Basic ${auth}` },
			});
		} catch (err) {
			logger.warn('[PlatformClient] Failed to fetch JIRA cloudId:', String(err));
			return null;
		}

		if (!response.ok) {
			logger.warn('[PlatformClient] JIRA tenant_info returned', response.status);
			return null;
		}

		const data = (await response.json()) as { cloudId?: string };
		if (!data.cloudId) {
			logger.warn('[PlatformClient] JIRA tenant_info missing cloudId');
			return null;
		}

		_jiraCloudIdCache.set(baseUrl, data.cloudId);
		return data.cloudId;
	}

	/** @internal Visible for testing only */
	static _reset(): void {
		_jiraCloudIdCache.clear();
	}
}
