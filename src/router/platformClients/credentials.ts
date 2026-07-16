/**
 * Credential resolution helpers for router platform clients.
 *
 * Resolves credentials once per call and returns typed objects.
 * Callers use raw `fetch()` — the router Docker image does not bundle
 * `src/trello/client.ts` or `src/github/client.ts`.
 */

import {
	findProjectById,
	getIntegrationCredential,
	getIntegrationCredentialOrNull,
} from '../../config/provider.js';
import type { LinearCredentials } from '../../linear/types.js';
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
		const apiKey = await getIntegrationCredential(projectId, 'pm', 'trello', 'api_key');
		const token = await getIntegrationCredential(projectId, 'pm', 'trello', 'token');
		return { apiKey, token };
	} catch {
		return null;
	}
}

/**
 * Resolve JIRA credentials for a project.
 * Returns `{ email, apiToken, baseUrl, auth, authType }` or `null` if credentials/config
 * are missing. The `auth` field is the pre-computed Base64 Basic auth string; `authType`
 * mirrors the project JIRA config (`'basic' | 'scoped'`, absent ⇒ `'basic'`) so the
 * platform client can route scoped tokens through the Atlassian gateway.
 */
export async function resolveJiraCredentials(
	projectId: string,
): Promise<JiraCredentialsWithAuth | null> {
	try {
		const email = await getIntegrationCredential(projectId, 'pm', 'jira', 'email');
		const apiToken = await getIntegrationCredential(projectId, 'pm', 'jira', 'api_token');
		const project = await findProjectById(projectId);
		const jiraConfig = project ? getJiraConfig(project) : undefined;
		const baseUrl = jiraConfig?.baseUrl ?? '';
		if (!baseUrl) throw new Error('Missing JIRA base URL');
		const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
		return { email, apiToken, baseUrl, auth, authType: jiraConfig?.authType };
	} catch {
		return null;
	}
}

/**
 * Resolve Linear credentials for a project.
 * Returns `{ apiKey }` or `null` if credentials are missing.
 */
export async function resolveLinearCredentials(
	projectId: string,
): Promise<LinearCredentials | null> {
	try {
		const apiKey = await getIntegrationCredential(projectId, 'pm', 'linear', 'api_key');
		return { apiKey };
	} catch {
		return null;
	}
}

/**
 * Resolve GitHub Projects credentials for a project.
 * Returns `{ token }` or `null` if credentials are missing.
 */
export async function resolveGitHubProjectsCredentials(
	projectId: string,
): Promise<{ token: string } | null> {
	try {
		const token = await getIntegrationCredential(projectId, 'pm', 'github-projects', 'token');
		return { token };
	} catch {
		return null;
	}
}

/**
 * Resolve the webhook secret for a given provider and project.
 *
 * - `'github'`: resolves the `webhook_secret` credential from the SCM integration.
 * - `'trello'`: resolves the `api_secret` credential from the PM integration.
 *   Trello computes webhook HMAC signatures using the API Secret (shown below the
 *   API Key at https://trello.com/power-ups/admin/), not the public API Key.
 * - `'jira'`: resolves the `webhook_secret` credential from the PM integration.
 * - `'linear'`: resolves the `webhook_secret` credential from the PM integration.
 * - `'github-projects'`: resolves the `webhook_secret` credential from the PM integration.
 *
 * Returns `null` if the credential is not configured.
 */
export async function resolveWebhookSecret(
	projectId: string,
	provider: 'github' | 'trello' | 'jira' | 'sentry' | 'linear' | 'github-projects',
): Promise<string | null> {
	if (provider === 'github') {
		return getIntegrationCredentialOrNull(projectId, 'scm', 'github', 'webhook_secret');
	}
	if (provider === 'jira') {
		return getIntegrationCredentialOrNull(projectId, 'pm', 'jira', 'webhook_secret');
	}
	if (provider === 'sentry') {
		return getIntegrationCredentialOrNull(projectId, 'alerting', 'sentry', 'webhook_secret');
	}
	if (provider === 'linear') {
		return getIntegrationCredentialOrNull(projectId, 'pm', 'linear', 'webhook_secret');
	}
	if (provider === 'github-projects') {
		return getIntegrationCredentialOrNull(projectId, 'pm', 'github-projects', 'webhook_secret');
	}
	// Trello signs webhook payloads with the API Secret, not the public API Key.
	return getIntegrationCredentialOrNull(projectId, 'pm', 'trello', 'api_secret');
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
