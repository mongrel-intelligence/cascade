/**
 * Shared, credential-aware platform API helpers for router modules.
 *
 * Resolves credentials once per call and exposes typed methods for
 * posting comments to Trello, GitHub, and JIRA. All errors are caught
 * and logged — never propagated (fire-and-forget contract).
 *
 * Uses raw `fetch()` throughout — the router Docker image does not bundle
 * `src/trello/client.ts` or `src/github/client.ts`.
 */

import { findProjectById, getIntegrationCredential } from '../config/provider.js';
import { getJiraConfig } from '../pm/config.js';
import { markdownToAdf } from '../pm/jira/adf.js';

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
// High-level platform API helpers
// ---------------------------------------------------------------------------

/**
 * Post a comment to a Trello card.
 * Resolves credentials, posts, and returns the new comment ID — or `null` on any failure.
 */
export async function postTrelloComment(
	projectId: string,
	cardId: string,
	text: string,
): Promise<string | null> {
	const creds = await resolveTrelloCredentials(projectId);
	if (!creds) return null;

	const url = `https://api.trello.com/1/cards/${cardId}/actions/comments?key=${creds.apiKey}&token=${creds.token}`;
	try {
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text }),
		});
		if (!response.ok) return null;
		const data = (await response.json()) as { id?: string };
		return data.id ?? null;
	} catch {
		return null;
	}
}

/**
 * Post a comment to a GitHub issue or PR.
 * Returns the new comment ID — or `null` on any failure.
 */
export async function postGitHubComment(
	token: string,
	repoFullName: string,
	prNumber: number,
	body: string,
): Promise<number | null> {
	const url = `https://api.github.com/repos/${repoFullName}/issues/${prNumber}/comments`;
	try {
		const response = await fetch(url, {
			method: 'POST',
			headers: resolveGitHubHeaders(token, { 'Content-Type': 'application/json' }),
			body: JSON.stringify({ body }),
		});
		if (!response.ok) return null;
		const data = (await response.json()) as { id?: number };
		return data.id ?? null;
	} catch {
		return null;
	}
}

/**
 * Post a comment to a JIRA issue.
 *
 * @param useAdf - When `true` (default), converts `body` from Markdown to ADF
 *   and posts to the v3 API. When `false`, posts plain text to the v2 API.
 *   Use `false` when the router image does not bundle the ADF converter.
 *
 * Returns the new comment ID — or `null` on any failure.
 */
export async function postJiraComment(
	projectId: string,
	issueKey: string,
	body: string,
	useAdf = true,
): Promise<string | null> {
	const creds = await resolveJiraCredentials(projectId);
	if (!creds) return null;

	const apiVersion = useAdf ? '3' : '2';
	const url = `${creds.baseUrl}/rest/api/${apiVersion}/issue/${issueKey}/comment`;
	const requestBody = useAdf
		? JSON.stringify({ body: markdownToAdf(body) })
		: JSON.stringify({ body });

	try {
		const response = await fetch(url, {
			method: 'POST',
			headers: {
				Authorization: `Basic ${creds.auth}`,
				'Content-Type': 'application/json',
			},
			body: requestBody,
		});
		if (!response.ok) return null;
		const data = (await response.json()) as { id?: string };
		return data.id ?? null;
	} catch {
		return null;
	}
}
