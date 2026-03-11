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

import {
	GitHubPlatformClient,
	JiraPlatformClient,
	TrelloPlatformClient,
} from './platformClients/index.js';

// ---------------------------------------------------------------------------
// Trello
// ---------------------------------------------------------------------------

export async function postTrelloAck(
	projectId: string,
	workItemId: string,
	message: string,
): Promise<string | null> {
	const client = new TrelloPlatformClient(projectId);
	const result = await client.postComment(workItemId, message);
	return typeof result === 'string' ? result : null;
}

export async function deleteTrelloAck(
	projectId: string,
	workItemId: string,
	commentId: string,
): Promise<void> {
	const client = new TrelloPlatformClient(projectId);
	await client.deleteComment(workItemId, commentId);
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
	const client = new GitHubPlatformClient(repoFullName, token);
	await client.deleteComment('', commentId);
}

// ---------------------------------------------------------------------------
// JIRA — delegates to JiraPlatformClient (ADF via api/3)
// ---------------------------------------------------------------------------

export async function postJiraAck(
	projectId: string,
	issueKey: string,
	message: string,
): Promise<string | null> {
	const client = new JiraPlatformClient(projectId);
	return client.postComment(issueKey, message);
}

export async function deleteJiraAck(
	projectId: string,
	issueKey: string,
	commentId: string,
): Promise<void> {
	const client = new JiraPlatformClient(projectId);
	await client.deleteComment(issueKey, commentId);
}

// ---------------------------------------------------------------------------
// Bot identity resolution — re-exported from bot-identity-resolvers.ts
// for backward compatibility with pm/ integrations and router/trello.ts.
// ---------------------------------------------------------------------------

export {
	_resetJiraBotCache,
	_resetTrelloBotCache,
	resolveJiraBotAccountId,
	resolveTrelloBotMemberId,
} from './bot-identity-resolvers.js';

// ---------------------------------------------------------------------------
// GitHub token resolution for router-side ack posting
// ---------------------------------------------------------------------------

export type { ResolvedGitHubToken } from './github-token-resolver.js';
export {
	resolveGitHubTokenForAck,
	resolveGitHubTokenForAckByAgent,
} from './github-token-resolver.js';
