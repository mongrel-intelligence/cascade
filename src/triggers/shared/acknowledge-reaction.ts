/**
 * Immediate acknowledgment reactions on webhook acceptance.
 *
 * Fires a platform-native reaction (👀) on the source entity
 * to signal "message received, processing" before the heavier agent
 * execution begins.
 */

import { githubClient } from '../../github/client.js';
import { jiraClient } from '../../jira/client.js';
import { trelloClient } from '../../trello/client.js';
import { safeOperation } from '../../utils/safeOperation.js';
import { isGitHubIssueCommentPayload, isGitHubPRReviewCommentPayload } from '../github/types.js';
import { isTrelloWebhookPayload } from '../types.js';

const TRELLO_EYES_EMOJI = {
	shortName: 'eyes',
	native: '👀',
	unified: '1f440',
};

export async function acknowledgeWithReaction(
	source: 'github' | 'trello' | 'jira',
	payload: unknown,
): Promise<void> {
	switch (source) {
		case 'github':
			await acknowledgeGitHub(payload);
			break;
		case 'trello':
			await acknowledgeTrello(payload);
			break;
		case 'jira':
			await acknowledgeJira(payload);
			break;
	}
}

async function acknowledgeGitHub(payload: unknown): Promise<void> {
	if (isGitHubIssueCommentPayload(payload)) {
		const [owner, repo] = payload.repository.full_name.split('/');
		await safeOperation(
			() => githubClient.addIssueCommentReaction(owner, repo, payload.comment.id, 'eyes'),
			{ action: 'add issue comment reaction', commentId: payload.comment.id },
		);
		return;
	}

	if (isGitHubPRReviewCommentPayload(payload)) {
		const [owner, repo] = payload.repository.full_name.split('/');
		await safeOperation(
			() => githubClient.addReviewCommentReaction(owner, repo, payload.comment.id, 'eyes'),
			{ action: 'add review comment reaction', commentId: payload.comment.id },
		);
		return;
	}

	// Other GitHub payloads (check_suite, pull_request, pull_request_review) → no-op
}

async function acknowledgeTrello(payload: unknown): Promise<void> {
	if (!isTrelloWebhookPayload(payload)) return;
	if (payload.action?.type !== 'commentCard') return;

	await safeOperation(() => trelloClient.addActionReaction(payload.action.id, TRELLO_EYES_EMOJI), {
		action: 'add Trello action reaction',
		actionId: payload.action.id,
	});
}

async function acknowledgeJira(payload: unknown): Promise<void> {
	const p = payload as Record<string, unknown>;
	const issue = p.issue as { id?: string; key?: string } | undefined;
	const comment = p.comment as { id?: string } | undefined;

	const issueId = issue?.id;
	const commentId = comment?.id;
	if (!commentId || !issueId) return;

	await safeOperation(() => jiraClient.addCommentReaction(issueId, commentId, 'atlassian-eyes'), {
		action: 'add JIRA comment reaction',
		issueId,
		commentId,
	});
}
