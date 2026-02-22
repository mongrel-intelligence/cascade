/**
 * Router-side acknowledgment comments.
 *
 * Posts a visible text comment on the source platform (Trello, GitHub, JIRA)
 * immediately when a webhook is received, before the worker starts. The
 * comment ID is passed to the worker so ProgressMonitor can update it
 * in-place instead of creating a duplicate.
 *
 * Follows the same raw `fetch()` pattern as notifications.ts and reactions.ts.
 * Errors are always caught and logged — never propagated.
 */

import { getProjectGitHubToken } from '../config/projects.js';
import {
	findProjectById,
	findProjectByRepo,
	getIntegrationCredential,
} from '../config/provider.js';
import { markdownToAdf } from '../pm/jira/adf.js';
import type { ProjectConfig } from '../types/index.js';

// ---------------------------------------------------------------------------
// Trello
// ---------------------------------------------------------------------------

export async function postTrelloAck(
	projectId: string,
	cardId: string,
	message: string,
): Promise<string | null> {
	let trelloApiKey: string;
	let trelloToken: string;
	try {
		trelloApiKey = await getIntegrationCredential(projectId, 'pm', 'api_key');
		trelloToken = await getIntegrationCredential(projectId, 'pm', 'token');
	} catch {
		console.warn('[Ack] Missing Trello credentials, skipping ack comment');
		return null;
	}

	const url = `https://api.trello.com/1/cards/${cardId}/actions/comments?key=${trelloApiKey}&token=${trelloToken}`;
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ text: message }),
	});

	if (!response.ok) {
		console.warn('[Ack] Trello comment failed:', response.status, await response.text());
		return null;
	}

	const data = (await response.json()) as { id?: string };
	console.log('[Ack] Trello ack comment posted for card:', cardId);
	return data.id ?? null;
}

export async function deleteTrelloAck(
	projectId: string,
	cardId: string,
	commentId: string,
): Promise<void> {
	let trelloApiKey: string;
	let trelloToken: string;
	try {
		trelloApiKey = await getIntegrationCredential(projectId, 'pm', 'api_key');
		trelloToken = await getIntegrationCredential(projectId, 'pm', 'token');
	} catch {
		return;
	}

	const url = `https://api.trello.com/1/cards/${cardId}/actions/${commentId}/comments?key=${trelloApiKey}&token=${trelloToken}`;
	try {
		await fetch(url, { method: 'DELETE' });
		console.log('[Ack] Trello orphan ack deleted:', commentId);
	} catch (err) {
		console.warn('[Ack] Failed to delete Trello orphan ack:', String(err));
	}
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

export async function postGitHubAck(
	repoFullName: string,
	prNumber: number,
	message: string,
	token: string,
): Promise<number | null> {
	const url = `https://api.github.com/repos/${repoFullName}/issues/${prNumber}/comments`;
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28',
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ body: message }),
	});

	if (!response.ok) {
		console.warn('[Ack] GitHub comment failed:', response.status, await response.text());
		return null;
	}

	const data = (await response.json()) as { id?: number };
	console.log('[Ack] GitHub ack comment posted for PR:', prNumber);
	return data.id ?? null;
}

export async function deleteGitHubAck(
	repoFullName: string,
	commentId: number,
	token: string,
): Promise<void> {
	const url = `https://api.github.com/repos/${repoFullName}/issues/comments/${commentId}`;
	try {
		await fetch(url, {
			method: 'DELETE',
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28',
			},
		});
		console.log('[Ack] GitHub orphan ack deleted:', commentId);
	} catch (err) {
		console.warn('[Ack] Failed to delete GitHub orphan ack:', String(err));
	}
}

// ---------------------------------------------------------------------------
// JIRA
// ---------------------------------------------------------------------------

export async function postJiraAck(
	projectId: string,
	issueKey: string,
	message: string,
): Promise<string | null> {
	let jiraEmail: string;
	let jiraApiToken: string;
	let jiraBaseUrl: string;
	try {
		jiraEmail = await getIntegrationCredential(projectId, 'pm', 'email');
		jiraApiToken = await getIntegrationCredential(projectId, 'pm', 'api_token');
		const project = await findProjectById(projectId);
		jiraBaseUrl = project?.jira?.baseUrl ?? '';
		if (!jiraBaseUrl) throw new Error('Missing JIRA base URL');
	} catch {
		console.warn('[Ack] Missing JIRA credentials, skipping ack comment');
		return null;
	}

	const auth = Buffer.from(`${jiraEmail}:${jiraApiToken}`).toString('base64');
	const adfBody = markdownToAdf(message);
	const url = `${jiraBaseUrl}/rest/api/3/issue/${issueKey}/comment`;
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Basic ${auth}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ body: adfBody }),
	});

	if (!response.ok) {
		console.warn('[Ack] JIRA comment failed:', response.status, await response.text());
		return null;
	}

	const data = (await response.json()) as { id?: string };
	console.log('[Ack] JIRA ack comment posted for issue:', issueKey);
	return data.id ?? null;
}

export async function deleteJiraAck(
	projectId: string,
	issueKey: string,
	commentId: string,
): Promise<void> {
	let jiraEmail: string;
	let jiraApiToken: string;
	let jiraBaseUrl: string;
	try {
		jiraEmail = await getIntegrationCredential(projectId, 'pm', 'email');
		jiraApiToken = await getIntegrationCredential(projectId, 'pm', 'api_token');
		const project = await findProjectById(projectId);
		jiraBaseUrl = project?.jira?.baseUrl ?? '';
		if (!jiraBaseUrl) throw new Error('Missing JIRA base URL');
	} catch {
		return;
	}

	const auth = Buffer.from(`${jiraEmail}:${jiraApiToken}`).toString('base64');
	const url = `${jiraBaseUrl}/rest/api/2/issue/${issueKey}/comment/${commentId}`;
	try {
		await fetch(url, {
			method: 'DELETE',
			headers: {
				Authorization: `Basic ${auth}`,
				'Content-Type': 'application/json',
			},
		});
		console.log('[Ack] JIRA orphan ack deleted:', commentId);
	} catch (err) {
		console.warn('[Ack] Failed to delete JIRA orphan ack:', String(err));
	}
}

// ---------------------------------------------------------------------------
// Bot identity resolution (cached, for self-authored comment detection)
// ---------------------------------------------------------------------------

const IDENTITY_CACHE_TTL_MS = 60_000; // 60 seconds

const jiraBotCache = new Map<string, { accountId: string; expiresAt: number }>();

/**
 * Resolve the JIRA account ID for the bot credentials linked to a project.
 * Cached per-project with 60s TTL. Returns null on any failure.
 */
export async function resolveJiraBotAccountId(projectId: string): Promise<string | null> {
	const cached = jiraBotCache.get(projectId);
	if (cached && Date.now() < cached.expiresAt) return cached.accountId;

	let jiraEmail: string;
	let jiraApiToken: string;
	let jiraBaseUrl: string;
	try {
		jiraEmail = await getIntegrationCredential(projectId, 'pm', 'email');
		jiraApiToken = await getIntegrationCredential(projectId, 'pm', 'api_token');
		const project = await findProjectById(projectId);
		jiraBaseUrl = project?.jira?.baseUrl ?? '';
		if (!jiraBaseUrl) throw new Error('Missing JIRA base URL');
	} catch {
		return null;
	}

	const auth = Buffer.from(`${jiraEmail}:${jiraApiToken}`).toString('base64');
	try {
		const response = await fetch(`${jiraBaseUrl}/rest/api/2/myself`, {
			headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
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

const trelloBotCache = new Map<string, { memberId: string; expiresAt: number }>();

/**
 * Resolve the Trello member ID for the bot credentials linked to a project.
 * Cached per-project with 60s TTL. Returns null on any failure.
 */
export async function resolveTrelloBotMemberId(projectId: string): Promise<string | null> {
	const cached = trelloBotCache.get(projectId);
	if (cached && Date.now() < cached.expiresAt) return cached.memberId;

	let trelloApiKey: string;
	let trelloToken: string;
	try {
		trelloApiKey = await getIntegrationCredential(projectId, 'pm', 'api_key');
		trelloToken = await getIntegrationCredential(projectId, 'pm', 'token');
	} catch {
		return null;
	}

	try {
		const response = await fetch(
			`https://api.trello.com/1/members/me?key=${trelloApiKey}&token=${trelloToken}`,
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

// ---------------------------------------------------------------------------
// Resolve GitHub token for router-side ack posting
// ---------------------------------------------------------------------------

/**
 * Resolve a GitHub token for posting ack comments from the router.
 * Uses the implementer token since ack comments are "from" the bot.
 */
export async function resolveGitHubTokenForAck(
	repoFullName: string,
): Promise<{ token: string; project: ProjectConfig } | null> {
	const project = await findProjectByRepo(repoFullName);
	if (!project) return null;

	try {
		const token = await getProjectGitHubToken(project);
		return { token, project };
	} catch {
		console.warn('[Ack] Missing GitHub token for repo:', repoFullName);
		return null;
	}
}
