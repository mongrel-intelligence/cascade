/**
 * Immediate acknowledgment reactions on webhook acceptance.
 *
 * Fires a platform-native reaction (👀) on the source comment
 * to signal "message received, processing" before the worker container
 * even starts.
 *
 * Errors are always caught and logged — never propagated.
 */

import { getProjectGitHubToken } from '../config/projects.js';
import { type PersonaIdentities, isCascadeBot } from '../github/personas.js';
import { trelloClient, withTrelloCredentials } from '../trello/client.js';
import type { ProjectConfig } from '../types/index.js';
import { parseRepoFullName } from '../utils/repo.js';
import {
	_resetJiraCloudIdCache,
	getJiraCloudId,
	resolveGitHubHeaders,
	resolveJiraCredentials,
	resolveTrelloCredentials,
} from './platformClients.js';

// Re-export cache reset for test compatibility
export { _resetJiraCloudIdCache };

// ---------------------------------------------------------------------------
// Platform-specific reaction senders
// ---------------------------------------------------------------------------

async function sendTrelloReaction(projectId: string, payload: unknown): Promise<void> {
	// Only react to commentCard actions
	const p = payload as Record<string, unknown>;
	const action = p.action as Record<string, unknown> | undefined;
	if (!action || action.type !== 'commentCard') return;

	const actionId = action.id as string | undefined;
	if (!actionId) return;

	const creds = await resolveTrelloCredentials(projectId);
	if (!creds) {
		console.warn('[Reactions] Missing Trello credentials, skipping reaction');
		return;
	}

	const emoji = { shortName: 'eyes', native: '👀', unified: '1f440' };

	try {
		await withTrelloCredentials({ apiKey: creds.apiKey, token: creds.token }, async () => {
			await trelloClient.addActionReaction(actionId, emoji);
		});
		console.log('[Reactions] Trello reaction sent for action:', actionId);
	} catch (err) {
		console.warn('[Reactions] Trello reaction failed:', String(err));
	}
}

/**
 * Send a GitHub 👀 reaction on an issue comment or PR review comment.
 *
 * Only reacts if:
 * 1. `personaIdentities` is provided
 * 2. The comment body contains `@implementer-username` (case-insensitive)
 * 3. The comment author is not a CASCADE bot (prevents reaction loops)
 *
 * The caller must resolve and pass the `project` — this avoids a redundant
 * `findProjectByRepo` lookup since the router already resolves it.
 */
async function sendGitHubReaction(
	repoFullName: string,
	payload: unknown,
	personaIdentities?: PersonaIdentities,
	project?: ProjectConfig,
): Promise<void> {
	const p = payload as Record<string, unknown>;

	const comment = p.comment as Record<string, unknown> | undefined;
	if (!comment) return;
	const commentId = comment.id as number | undefined;
	if (commentId === undefined) return;

	// Only react if we have persona identities
	if (!personaIdentities) {
		console.log('[Reactions] No persona identities provided, skipping GitHub reaction');
		return;
	}

	// Skip if comment author is a CASCADE bot (prevent reaction loops)
	const commenter = (comment.user as Record<string, unknown> | undefined)?.login as
		| string
		| undefined;
	if (commenter && isCascadeBot(commenter, personaIdentities)) {
		console.log('[Reactions] Skipping GitHub reaction: comment is from a CASCADE bot', {
			commenter,
		});
		return;
	}

	// Only react if the comment body contains @implementer mention
	const body = comment.body as string | undefined;
	const mentionRegex = new RegExp(`@${personaIdentities.implementer}\\b`, 'i');
	if (!body || !mentionRegex.test(body)) {
		console.log('[Reactions] Skipping GitHub reaction: no @implementer mention in comment body');
		return;
	}

	// Determine comment type from payload shape
	const commentType = getGitHubCommentType(p);
	if (!commentType) return;

	if (!project) {
		console.warn('[Reactions] No project provided, skipping GitHub reaction', {
			repoFullName,
		});
		return;
	}

	let githubToken: string;
	try {
		githubToken = await getProjectGitHubToken(project);
	} catch {
		console.warn('[Reactions] Missing GitHub token, skipping reaction');
		return;
	}

	const { owner, repo } = parseRepoFullName(repoFullName);
	const segment = commentType === 'issue' ? 'issues' : 'pulls';
	const url = `https://api.github.com/repos/${owner}/${repo}/${segment}/comments/${commentId}/reactions`;

	const response = await fetch(url, {
		method: 'POST',
		headers: resolveGitHubHeaders(githubToken, { 'Content-Type': 'application/json' }),
		body: JSON.stringify({ content: 'eyes' }),
	});

	if (!response.ok) {
		console.warn('[Reactions] GitHub reaction failed:', response.status, await response.text());
	} else {
		console.log('[Reactions] GitHub reaction sent for comment:', commentId);
	}
}

function getGitHubCommentType(p: Record<string, unknown>): 'issue' | 'pull_request' | null {
	if (typeof p.issue === 'object' && p.issue !== null) return 'issue';
	if (typeof p.pull_request === 'object' && p.pull_request !== null) return 'pull_request';
	return null;
}

async function sendJiraReaction(projectId: string, payload: unknown): Promise<void> {
	const p = payload as Record<string, unknown>;
	const issue = p.issue as Record<string, unknown> | undefined;
	const comment = p.comment as Record<string, unknown> | undefined;

	const issueId = issue?.id as string | undefined;
	const commentId = comment?.id as string | undefined;

	if (!issueId || !commentId) return;

	const creds = await resolveJiraCredentials(projectId);
	if (!creds) {
		console.warn('[Reactions] Missing JIRA credentials, skipping reaction');
		return;
	}

	// Try the reactions API first
	const cloudId = await getJiraCloudId(creds);
	if (cloudId) {
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
			console.log('[Reactions] JIRA reaction sent for comment:', commentId);
			return;
		}

		console.warn(
			'[Reactions] JIRA reactions API failed:',
			reactionResponse.status,
			'— skipping (no fallback to avoid webhook loops)',
		);
	}
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Send an acknowledgment reaction for an incoming webhook.
 * Dispatches to Trello (👀), GitHub (👀), or JIRA (💭) based on source.
 *
 * For GitHub, pass `repoFullName` as the `projectId` parameter, along with
 * `personaIdentities` and the already-resolved `project`. The reaction is
 * only sent when the comment contains an @mention of the implementer bot
 * (and is not from a bot itself).
 *
 * Fire-and-forget: errors are caught and logged, never propagated.
 */
export async function sendAcknowledgeReaction(
	source: 'trello' | 'github' | 'jira',
	projectId: string,
	payload: unknown,
	personaIdentities?: PersonaIdentities,
	project?: ProjectConfig,
): Promise<void> {
	try {
		if (source === 'trello') {
			await sendTrelloReaction(projectId, payload);
		} else if (source === 'github') {
			await sendGitHubReaction(projectId, payload, personaIdentities, project);
		} else if (source === 'jira') {
			await sendJiraReaction(projectId, payload);
		}
	} catch (err) {
		console.error('[Reactions] Unexpected error sending reaction:', String(err));
	}
}
