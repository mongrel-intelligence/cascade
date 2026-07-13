/**
 * JIRA platform client for posting/deleting comments and reactions via the JIRA REST API.
 *
 * Comments are posted using the JIRA REST API v3 with Atlassian Document Format (ADF) bodies
 * so that rich text (bold, code, lists) renders correctly in JIRA Cloud.
 */

import { markdownToAdf } from '../../pm/jira/adf.js';
import { logger } from '../../utils/logging.js';
import { resolveJiraCredentials } from './credentials.js';
import type { JiraCredentialsWithAuth, PlatformCommentClient } from './types.js';

/**
 * Atlassian REST gateway origin used to route scoped API tokens. Mirrors
 * `src/jira/api-host.ts` — the in-worker resolver — so router-side ack/PM
 * comments hit the same host as the jira.js client under `authType: 'scoped'`.
 */
const ATLASSIAN_GATEWAY_ORIGIN = 'https://api.atlassian.com';

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
			const adfBody = markdownToAdf(message);
			const base = await this._resolveEffectiveBase(creds);
			const url = `${base}/rest/api/3/issue/${issueKey}/comment`;
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					Authorization: `Basic ${creds.auth}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ body: adfBody }),
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

		const base = await this._resolveEffectiveBase(creds);
		const url = `${base}/rest/api/2/issue/${issueKey}/comment/${commentId}`;
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
	 *
	 * Intentionally stays on the tenant **site URL** even under `authType: 'scoped'`.
	 * `/rest/reactions/1.0/` is not a confirmed gateway-supported scoped-token API
	 * (the gateway probe returned `401 scope does not match`; MNG-1735), so this
	 * call must NOT route through {@link _resolveEffectiveBase}. It is best-effort:
	 * failures degrade to a warn log and never fail the run.
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
			// Site URL only — the internal reactions API is not gateway-routable (MNG-1735).
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

	/**
	 * Resolve the effective REST base host for v3/v2 comment calls.
	 *
	 * - `authType` basic / absent ⇒ the tenant site URL (`creds.baseUrl`) —
	 *   classic behavior, unchanged.
	 * - `authType === 'scoped'` ⇒ the Atlassian gateway
	 *   `https://api.atlassian.com/ex/jira/{cloudId}`, where `cloudId` is resolved
	 *   from the site `/_edge/tenant_info` endpoint via the existing per-`baseUrl`
	 *   cache. If cloudId resolution fails, degrade to the site URL so the
	 *   fire-and-forget comment path still attempts a post rather than throwing.
	 */
	private async _resolveEffectiveBase(creds: JiraCredentialsWithAuth): Promise<string> {
		if (creds.authType !== 'scoped') {
			return creds.baseUrl;
		}

		const cloudId = await this._getCloudId(creds.baseUrl, creds.auth);
		if (!cloudId) {
			logger.warn(
				'[PlatformClient] Scoped JIRA cloudId unavailable, falling back to site URL:',
				creds.baseUrl,
			);
			return creds.baseUrl;
		}

		return `${ATLASSIAN_GATEWAY_ORIGIN}/ex/jira/${cloudId}`;
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
