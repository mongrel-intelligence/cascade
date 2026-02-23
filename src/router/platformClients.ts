/**
 * Centralized platform credential resolution for router-side modules.
 *
 * Provides lightweight helpers that encapsulate credential resolution per
 * platform (Trello, GitHub, JIRA) and cached bot identity lookups.
 * All callers (acknowledgments, reactions, notifications) use these instead
 * of duplicating the resolve-try/catch pattern themselves.
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
// Trello
// ---------------------------------------------------------------------------

export interface TrelloCredentials {
	apiKey: string;
	token: string;
}

/**
 * Resolve Trello credentials (api_key + token) for a project.
 * Returns null if either credential is missing.
 */
export async function getTrelloCredentialsForProject(
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

// ---------------------------------------------------------------------------
// JIRA
// ---------------------------------------------------------------------------

export interface JiraAuth {
	email: string;
	apiToken: string;
	baseUrl: string;
	/** Pre-computed Base64 Basic auth string */
	basicAuth: string;
}

/**
 * Resolve JIRA credentials (email + api_token + baseUrl) for a project.
 * Returns null if any piece is missing or the JIRA base URL is unavailable.
 */
export async function getJiraAuthForProject(projectId: string): Promise<JiraAuth | null> {
	try {
		const email = await getIntegrationCredential(projectId, 'pm', 'email');
		const apiToken = await getIntegrationCredential(projectId, 'pm', 'api_token');
		const project = await findProjectById(projectId);
		const baseUrl = (project ? getJiraConfig(project)?.baseUrl : undefined) ?? '';
		if (!baseUrl) throw new Error('Missing JIRA base URL');
		const basicAuth = Buffer.from(`${email}:${apiToken}`).toString('base64');
		return { email, apiToken, baseUrl, basicAuth };
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// GitHub
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

	const creds = await getTrelloCredentialsForProject(projectId);
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

	const auth = await getJiraAuthForProject(projectId);
	if (!auth) return null;

	try {
		const response = await fetch(`${auth.baseUrl}/rest/api/2/myself`, {
			headers: { Authorization: `Basic ${auth.basicAuth}`, Accept: 'application/json' },
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
export async function getJiraCloudId(auth: JiraAuth): Promise<string | null> {
	const cached = jiraCloudIdCache.get(auth.baseUrl);
	if (cached) return cached;

	let response: Response;
	try {
		response = await fetch(`${auth.baseUrl}/_edge/tenant_info`, {
			headers: { Authorization: `Basic ${auth.basicAuth}` },
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

	jiraCloudIdCache.set(auth.baseUrl, data.cloudId);
	return data.cloudId;
}

/** @internal Visible for testing only */
export function _resetJiraCloudIdCache(): void {
	jiraCloudIdCache.clear();
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
