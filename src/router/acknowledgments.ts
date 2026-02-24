/**
 * Router-side acknowledgment comments.
 *
 * Posts a visible text comment on the source platform (Trello, GitHub, JIRA)
 * immediately when a webhook is received, before the worker starts. The
 * comment ID is passed to the worker so ProgressMonitor can update it
 * in-place instead of creating a duplicate.
 *
 * Delegates to PlatformCommentClient implementations in platformClients.ts.
 * Errors are always caught and logged — never propagated.
 */

import { getProjectGitHubToken } from '../config/projects.js';
import { findProjectByRepo } from '../config/provider.js';
import { markdownToAdf } from '../pm/jira/adf.js';
import type { ProjectConfig } from '../types/index.js';
import { logger } from '../utils/logging.js';
import { BotIdentityCache } from './bot-identity.js';
import {
	GitHubPlatformClient,
	resolveGitHubHeaders,
	resolveJiraCredentials,
	resolveTrelloCredentials,
} from './platformClients.js';

// ---------------------------------------------------------------------------
// Trello
// ---------------------------------------------------------------------------

export async function postTrelloAck(
	projectId: string,
	cardId: string,
	message: string,
): Promise<string | null> {
	const creds = await resolveTrelloCredentials(projectId);
	if (!creds) {
		logger.warn('[Ack] Missing Trello credentials, skipping ack comment');
		return null;
	}

	const url = `https://api.trello.com/1/cards/${cardId}/actions/comments?key=${creds.apiKey}&token=${creds.token}`;
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ text: message }),
	});

	if (!response.ok) {
		logger.warn('[Ack] Trello comment failed:', response.status, await response.text());
		return null;
	}

	const data = (await response.json()) as { id?: string };
	logger.info('[Ack] Trello ack comment posted for card:', cardId);
	return data.id ?? null;
}

export async function deleteTrelloAck(
	projectId: string,
	cardId: string,
	commentId: string,
): Promise<void> {
	const creds = await resolveTrelloCredentials(projectId);
	if (!creds) return;

	const url = `https://api.trello.com/1/cards/${cardId}/actions/${commentId}/comments?key=${creds.apiKey}&token=${creds.token}`;
	try {
		await fetch(url, { method: 'DELETE' });
		logger.info('[Ack] Trello orphan ack deleted:', commentId);
	} catch (err) {
		logger.warn('[Ack] Failed to delete Trello orphan ack:', String(err));
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
	const client = new GitHubPlatformClient(repoFullName, token);
	const result = await client.postComment(prNumber, message);

	// GitHubPlatformClient already logs success/failure internally
	if (result === null) {
		return null;
	}
	return typeof result === 'number' ? result : null;
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
			headers: resolveGitHubHeaders(token),
		});
		logger.info('[Ack] GitHub orphan ack deleted:', commentId);
	} catch (err) {
		logger.warn('[Ack] Failed to delete GitHub orphan ack:', String(err));
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
	const creds = await resolveJiraCredentials(projectId);
	if (!creds) {
		logger.warn('[Ack] Missing JIRA credentials, skipping ack comment');
		return null;
	}

	const adfBody = markdownToAdf(message);
	const url = `${creds.baseUrl}/rest/api/3/issue/${issueKey}/comment`;
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Basic ${creds.auth}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ body: adfBody }),
	});

	if (!response.ok) {
		logger.warn('[Ack] JIRA comment failed:', response.status, await response.text());
		return null;
	}

	const data = (await response.json()) as { id?: string };
	logger.info('[Ack] JIRA ack comment posted for issue:', issueKey);
	return data.id ?? null;
}

export async function deleteJiraAck(
	projectId: string,
	issueKey: string,
	commentId: string,
): Promise<void> {
	const creds = await resolveJiraCredentials(projectId);
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
		logger.info('[Ack] JIRA orphan ack deleted:', commentId);
	} catch (err) {
		logger.warn('[Ack] Failed to delete JIRA orphan ack:', String(err));
	}
}

// ---------------------------------------------------------------------------
// Bot identity resolution (cached, for self-authored comment detection)
// ---------------------------------------------------------------------------

const jiraBotIdentityCache = new BotIdentityCache<string>('accountId');
const trelloBotIdentityCache = new BotIdentityCache<string>('memberId');

/**
 * Resolve the JIRA account ID for the bot credentials linked to a project.
 * Cached per-project with 60s TTL. Returns null on any failure.
 */
export async function resolveJiraBotAccountId(projectId: string): Promise<string | null> {
	return jiraBotIdentityCache.resolve(projectId, async () => {
		const creds = await resolveJiraCredentials(projectId);
		if (!creds) return null;

		const response = await fetch(`${creds.baseUrl}/rest/api/2/myself`, {
			headers: { Authorization: `Basic ${creds.auth}`, Accept: 'application/json' },
		});
		if (!response.ok) return null;

		const data = (await response.json()) as { accountId?: string };
		return data.accountId ?? null;
	});
}

/** @internal Visible for testing only */
export function _resetJiraBotCache(): void {
	jiraBotIdentityCache._reset();
}

/**
 * Resolve the Trello member ID for the bot credentials linked to a project.
 * Cached per-project with 60s TTL. Returns null on any failure.
 */
export async function resolveTrelloBotMemberId(projectId: string): Promise<string | null> {
	return trelloBotIdentityCache.resolve(projectId, async () => {
		const creds = await resolveTrelloCredentials(projectId);
		if (!creds) return null;

		const response = await fetch(
			`https://api.trello.com/1/members/me?key=${creds.apiKey}&token=${creds.token}`,
			{ headers: { Accept: 'application/json' } },
		);
		if (!response.ok) return null;

		const data = (await response.json()) as { id?: string };
		return data.id ?? null;
	});
}

/** @internal Visible for testing only */
export function _resetTrelloBotCache(): void {
	trelloBotIdentityCache._reset();
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
		logger.warn('[Ack] Missing GitHub token for repo:', repoFullName);
		return null;
	}
}
