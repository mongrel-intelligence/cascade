/**
 * Credential resolution helpers for router platform clients.
 *
 * Resolves credentials once per call and returns typed objects.
 * Callers use raw `fetch()` — the router Docker image does not bundle
 * `src/trello/client.ts` or `src/github/client.ts`.
 */

import { findProjectById, getIntegrationCredential } from '../../config/provider.js';
import { getJiraConfig } from '../../pm/config.js';
import type { JiraCredentialsWithAuth, TrelloCredentials } from './types.js';

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
export async function resolveJiraCredentials(
	projectId: string,
): Promise<JiraCredentialsWithAuth | null> {
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
