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

import { markdownToAdf } from '../pm/jira/adf.js';
import {
	_resetJiraBotCache,
	_resetTrelloBotCache,
	resolveGitHubHeaders,
	resolveGitHubTokenForAck,
	resolveJiraBotAccountId,
	resolveJiraCredentials,
	resolveTrelloBotMemberId,
	resolveTrelloCredentials,
} from './platformClients.js';

// Re-export bot-identity helpers so callers that import from acknowledgments
// continue to work without changes.
export {
	resolveJiraBotAccountId,
	resolveTrelloBotMemberId,
	resolveGitHubTokenForAck,
	_resetJiraBotCache,
	_resetTrelloBotCache,
};

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
		console.warn('[Ack] Missing Trello credentials, skipping ack comment');
		return null;
	}

	const url = `https://api.trello.com/1/cards/${cardId}/actions/comments?key=${creds.apiKey}&token=${creds.token}`;
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
	const creds = await resolveTrelloCredentials(projectId);
	if (!creds) return;

	const url = `https://api.trello.com/1/cards/${cardId}/actions/${commentId}/comments?key=${creds.apiKey}&token=${creds.token}`;
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
		headers: resolveGitHubHeaders(token, { 'Content-Type': 'application/json' }),
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
			headers: resolveGitHubHeaders(token),
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
	const creds = await resolveJiraCredentials(projectId);
	if (!creds) {
		console.warn('[Ack] Missing JIRA credentials, skipping ack comment');
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
		console.log('[Ack] JIRA orphan ack deleted:', commentId);
	} catch (err) {
		console.warn('[Ack] Failed to delete JIRA orphan ack:', String(err));
	}
}
