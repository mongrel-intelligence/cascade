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
import {
	findProjectById,
	findProjectByRepo,
	getIntegrationCredential,
} from '../config/provider.js';
import { type PersonaIdentities, isCascadeBot } from '../github/personas.js';
import { trelloClient, withTrelloCredentials } from '../trello/client.js';

// In-memory JIRA CloudId cache keyed by baseUrl
const jiraCloudIdCache = new Map<string, string>();

/**
 * Lightweight JIRA cloudId resolver with in-memory cache.
 * Mirrors jiraClient.getCloudId() but uses standalone fetch() with explicit credentials.
 */
async function getJiraCloudId(
	baseUrl: string,
	email: string,
	apiToken: string,
): Promise<string | null> {
	const cached = jiraCloudIdCache.get(baseUrl);
	if (cached) return cached;

	const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
	let response: Response;
	try {
		response = await fetch(`${baseUrl}/_edge/tenant_info`, {
			headers: { Authorization: `Basic ${auth}` },
		});
	} catch (err) {
		console.warn('[Reactions] Failed to fetch JIRA cloudId:', String(err));
		return null;
	}

	if (!response.ok) {
		console.warn('[Reactions] JIRA tenant_info returned', response.status);
		return null;
	}

	const data = (await response.json()) as { cloudId?: string };
	if (!data.cloudId) {
		console.warn('[Reactions] JIRA tenant_info missing cloudId');
		return null;
	}

	jiraCloudIdCache.set(baseUrl, data.cloudId);
	return data.cloudId;
}

/** @internal Visible for testing only */
export function _resetJiraCloudIdCache(): void {
	jiraCloudIdCache.clear();
}

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

	let trelloApiKey: string;
	let trelloToken: string;
	try {
		trelloApiKey = await getIntegrationCredential(projectId, 'pm', 'api_key');
		trelloToken = await getIntegrationCredential(projectId, 'pm', 'token');
	} catch {
		console.warn('[Reactions] Missing Trello credentials, skipping reaction');
		return;
	}

	const emoji = { shortName: 'eyes', native: '👀', unified: '1f440' };

	try {
		await withTrelloCredentials({ apiKey: trelloApiKey, token: trelloToken }, async () => {
			await trelloClient.addActionReaction(actionId, emoji);
		});
		console.log('[Reactions] Trello reaction sent for action:', actionId);
	} catch (err) {
		console.warn('[Reactions] Trello reaction failed:', String(err));
	}
}

/**
 * Send a GitHub 👀 reaction on an issue comment or PR review comment.
 * `repoFullName` is used to look up the project and resolve credentials.
 *
 * Only reacts if:
 * 1. `personaIdentities` is provided
 * 2. The comment body contains `@implementer-username` (case-insensitive)
 * 3. The comment author is not a CASCADE bot (prevents reaction loops)
 */
async function sendGitHubReaction(
	repoFullName: string,
	payload: unknown,
	personaIdentities?: PersonaIdentities,
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

	// Distinguish issue_comment from pull_request_review_comment by the presence
	// of p.issue (issue_comment) vs p.pull_request (pull_request_review_comment).
	const isIssueComment = typeof p.issue === 'object' && p.issue !== null;
	const isPRReviewComment = typeof p.pull_request === 'object' && p.pull_request !== null;

	if (!isIssueComment && !isPRReviewComment) return;

	const project = await findProjectByRepo(repoFullName);
	if (!project) {
		console.warn('[Reactions] No project found for repo, skipping GitHub reaction', {
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

	const [owner, repo] = repoFullName.split('/');
	let url: string;
	if (isIssueComment) {
		url = `https://api.github.com/repos/${owner}/${repo}/issues/comments/${commentId}/reactions`;
	} else {
		url = `https://api.github.com/repos/${owner}/${repo}/pulls/comments/${commentId}/reactions`;
	}

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${githubToken}`,
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28',
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ content: 'eyes' }),
	});

	if (!response.ok) {
		console.warn('[Reactions] GitHub reaction failed:', response.status, await response.text());
	} else {
		console.log('[Reactions] GitHub reaction sent for comment:', commentId);
	}
}

async function sendJiraReaction(projectId: string, payload: unknown): Promise<void> {
	const p = payload as Record<string, unknown>;
	const issue = p.issue as Record<string, unknown> | undefined;
	const comment = p.comment as Record<string, unknown> | undefined;

	const issueId = issue?.id as string | undefined;
	const commentId = comment?.id as string | undefined;

	if (!issueId || !commentId) return;

	let jiraEmail: string;
	let jiraApiToken: string;
	let jiraBaseUrl: string;
	try {
		jiraEmail = await getIntegrationCredential(projectId, 'pm', 'email');
		jiraApiToken = await getIntegrationCredential(projectId, 'pm', 'api_token');
		// JIRA_BASE_URL is in the project config, not credentials.
		const project = await findProjectById(projectId);
		jiraBaseUrl = project?.jira?.baseUrl ?? '';
		if (!jiraBaseUrl) throw new Error('Missing JIRA base URL');
	} catch {
		console.warn('[Reactions] Missing JIRA credentials, skipping reaction');
		return;
	}

	const auth = Buffer.from(`${jiraEmail}:${jiraApiToken}`).toString('base64');

	// Try the reactions API first
	const cloudId = await getJiraCloudId(jiraBaseUrl, jiraEmail, jiraApiToken);
	if (cloudId) {
		const emojiId = 'atlassian-thought_balloon';
		const ari = `ari%3Acloud%3Ajira%3A${cloudId}%3Acomment%2F${issueId}%2F${commentId}`;
		const reactionsUrl = `${jiraBaseUrl}/rest/reactions/1.0/reactions/${ari}/${emojiId}`;
		const reactionResponse = await fetch(reactionsUrl, {
			method: 'PUT',
			headers: {
				Authorization: `Basic ${auth}`,
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
 * For GitHub, pass `repoFullName` as the `projectId` parameter — it will be
 * used to resolve the project via `findProjectByRepo`. Also pass
 * `personaIdentities` so the reaction is only sent when the comment contains
 * an @mention of the implementer bot (and is not from a bot itself).
 *
 * Fire-and-forget: errors are caught and logged, never propagated.
 */
export async function sendAcknowledgeReaction(
	source: 'trello' | 'github' | 'jira',
	projectId: string,
	payload: unknown,
	personaIdentities?: PersonaIdentities,
): Promise<void> {
	try {
		if (source === 'trello') {
			await sendTrelloReaction(projectId, payload);
		} else if (source === 'github') {
			await sendGitHubReaction(projectId, payload, personaIdentities);
		} else if (source === 'jira') {
			await sendJiraReaction(projectId, payload);
		}
	} catch (err) {
		console.error('[Reactions] Unexpected error sending reaction:', String(err));
	}
}
