/**
 * Shared credential resolution and platform API header helpers for router modules.
 *
 * Resolves credentials once per call and returns typed objects.
 * Also provides cached bot identity lookups and JIRA cloudId resolution.
 * Callers use raw `fetch()` — the router Docker image does not bundle
 * `src/trello/client.ts` or `src/github/client.ts`.
 */

import { getProjectGitHubToken } from '../config/projects.js';
import {
	findProjectById,
	findProjectByRepo,
	getIntegrationCredential,
} from '../config/provider.js';
import { getJiraConfig } from '../pm/config.js';
import type { ProjectConfig } from '../types/index.js';

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
// GitHub token resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a GitHub implementer token for a given repository.
 * Returns the token and resolved project, or null on failure.
 */
export async function getGitHubTokenForProject(
	repoFullName: string,
): Promise<{ token: string; project: ProjectConfig } | null> {
	const project = await findProjectByRepo(repoFullName);
	if (!project) return null;

	try {
		const token = await getProjectGitHubToken(project);
		return { token, project };
	} catch {
		return null;
	}
}

/**
 * Resolve a GitHub implementer token for acknowledgment posting.
 * Alias of getGitHubTokenForProject for backward compatibility.
 */
export async function resolveGitHubTokenForAck(
	repoFullName: string,
): Promise<{ token: string; project: ProjectConfig } | null> {
	return getGitHubTokenForProject(repoFullName);
}

// ---------------------------------------------------------------------------
// Bot identity caches
// ---------------------------------------------------------------------------

const IDENTITY_CACHE_TTL_MS = 60_000; // 60 seconds

// Trello bot member ID cache (per project)
const trelloBotCache = new Map<string, { memberId: string; expiresAt: number }>();

/**
 * Resolve the Trello member ID for the bot credentials linked to a project.
 * Cached per-project with 60s TTL. Returns null on any failure.
 */
export async function resolveTrelloBotMemberId(projectId: string): Promise<string | null> {
	const cached = trelloBotCache.get(projectId);
	if (cached && Date.now() < cached.expiresAt) return cached.memberId;

	const creds = await resolveTrelloCredentials(projectId);
	if (!creds) return null;

	try {
		const response = await fetch(
			`https://api.trello.com/1/members/me?key=${creds.apiKey}&token=${creds.token}`,
			{ headers: { Accept: 'application/json' } },
		);
		if (!response.ok) return null;

		const data = (await response.json()) as { id?: string };
		if (!data.id) return null;

		trelloBotCache.set(projectId, {
			memberId: data.id,
			expiresAt: Date.now() + IDENTITY_CACHE_TTL_MS,
		});
		return data.id;
	} catch {
		return null;
	}
}

/** @internal Visible for testing only */
export function _resetTrelloBotCache(): void {
	trelloBotCache.clear();
}

// JIRA bot account ID cache (per project)
const jiraBotCache = new Map<string, { accountId: string; expiresAt: number }>();

/**
 * Resolve the JIRA account ID for the bot credentials linked to a project.
 * Cached per-project with 60s TTL. Returns null on any failure.
 */
export async function resolveJiraBotAccountId(projectId: string): Promise<string | null> {
	const cached = jiraBotCache.get(projectId);
	if (cached && Date.now() < cached.expiresAt) return cached.accountId;

	const creds = await resolveJiraCredentials(projectId);
	if (!creds) return null;

	try {
		const response = await fetch(`${creds.baseUrl}/rest/api/2/myself`, {
			headers: { Authorization: `Basic ${creds.auth}`, Accept: 'application/json' },
		});
		if (!response.ok) return null;

		const data = (await response.json()) as { accountId?: string };
		if (!data.accountId) return null;

		jiraBotCache.set(projectId, {
			accountId: data.accountId,
			expiresAt: Date.now() + IDENTITY_CACHE_TTL_MS,
		});
		return data.accountId;
	} catch {
		return null;
	}
}

/** @internal Visible for testing only */
export function _resetJiraBotCache(): void {
	jiraBotCache.clear();
}

// JIRA CloudId cache (per baseUrl)
const jiraCloudIdCache = new Map<string, string>();

/**
 * Lightweight JIRA cloudId resolver with in-memory cache.
 * Keyed by baseUrl. Returns null on any failure.
 */
export async function getJiraCloudId(creds: JiraCredentials): Promise<string | null> {
	const cached = jiraCloudIdCache.get(creds.baseUrl);
	if (cached) return cached;

	let response: Response;
	try {
		response = await fetch(`${creds.baseUrl}/_edge/tenant_info`, {
			headers: { Authorization: `Basic ${creds.auth}` },
		});
	} catch (err) {
		console.warn('[PlatformClients] Failed to fetch JIRA cloudId:', String(err));
		return null;
	}

	if (!response.ok) {
		console.warn('[PlatformClients] JIRA tenant_info returned', response.status);
		return null;
	}

	const data = (await response.json()) as { cloudId?: string };
	if (!data.cloudId) {
		console.warn('[PlatformClients] JIRA tenant_info missing cloudId');
		return null;
	}

	jiraCloudIdCache.set(creds.baseUrl, data.cloudId);
	return data.cloudId;
}

/** @internal Visible for testing only */
export function _resetJiraCloudIdCache(): void {
	jiraCloudIdCache.clear();
}
