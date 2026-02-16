/**
 * JIRA comment @mention trigger.
 *
 * Fires when someone @mentions the CASCADE bot user in a JIRA issue comment.
 * Runs the respond-to-planning-comment agent.
 */

import { jiraClient } from '../../jira/client.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';

interface JiraWebhookPayload {
	webhookEvent: string;
	issue?: {
		key: string;
		fields?: {
			project?: { key?: string };
			status?: { name?: string };
		};
	};
	comment?: {
		body?: unknown;
		author?: { displayName?: string; accountId?: string };
	};
}

// Cache authenticated user info to avoid repeated API calls
let cachedUserInfo: { accountId: string; displayName: string } | null = null;

async function getAuthenticatedUserInfo(): Promise<{ accountId: string; displayName: string }> {
	if (cachedUserInfo) {
		return cachedUserInfo;
	}
	const me = await jiraClient.getMyself();
	cachedUserInfo = {
		accountId: me.accountId ?? '',
		displayName: me.displayName ?? '',
	};
	logger.info('Cached authenticated JIRA user info', {
		accountId: cachedUserInfo.accountId,
		displayName: cachedUserInfo.displayName,
	});
	return cachedUserInfo;
}

/**
 * Extract plain text from an ADF body (simple recursive extraction).
 */
function extractTextFromAdf(body: unknown): string {
	if (!body || typeof body !== 'object') return '';
	const node = body as Record<string, unknown>;

	if (node.type === 'text' && typeof node.text === 'string') {
		return node.text;
	}

	if (node.type === 'mention' && typeof node.attrs === 'object') {
		const attrs = node.attrs as Record<string, unknown>;
		return `@${attrs.text ?? attrs.id ?? ''}`;
	}

	if (Array.isArray(node.content)) {
		return (node.content as unknown[]).map(extractTextFromAdf).join('');
	}

	return '';
}

/**
 * Check if ADF body contains an @mention for the given account ID.
 * JIRA ADF represents mentions as nodes with type=mention and attrs.id=accountId.
 */
function hasMentionInAdf(body: unknown, accountId: string): boolean {
	if (!body || typeof body !== 'object') return false;
	const node = body as Record<string, unknown>;

	if (node.type === 'mention' && typeof node.attrs === 'object') {
		const attrs = node.attrs as Record<string, unknown>;
		return attrs.id === accountId;
	}

	if (Array.isArray(node.content)) {
		return (node.content as unknown[]).some((child) => hasMentionInAdf(child, accountId));
	}

	return false;
}

export class JiraCommentMentionTrigger implements TriggerHandler {
	name = 'jira-comment-mention';
	description =
		'Triggers respond-to-planning-comment agent when someone @mentions the bot in a JIRA comment';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'jira') return false;

		const payload = ctx.payload as JiraWebhookPayload;
		return payload.webhookEvent === 'comment_created' || payload.webhookEvent === 'comment_updated';
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		const payload = ctx.payload as JiraWebhookPayload;
		const issueKey = payload.issue?.key;
		const commentBody = payload.comment?.body;
		const commentAuthor = payload.comment?.author;

		if (!issueKey || !commentBody) {
			return null;
		}

		// Resolve our JIRA identity
		const userInfo = await getAuthenticatedUserInfo();

		// Check for @mention in ADF body
		if (!hasMentionInAdf(commentBody, userInfo.accountId)) {
			return null;
		}

		// Skip self-authored comments to prevent infinite loops
		if (commentAuthor?.accountId === userInfo.accountId) {
			logger.debug('Skipping self-authored JIRA comment to prevent infinite loop', {
				issueKey,
				accountId: userInfo.accountId,
			});
			return null;
		}

		const commentText = extractTextFromAdf(commentBody);
		const authorName = commentAuthor?.displayName || 'unknown';

		logger.info('JIRA comment @mention detected, triggering agent', {
			issueKey,
			commentAuthor: authorName,
			botAccountId: userInfo.accountId,
		});

		return {
			agentType: 'respond-to-planning-comment',
			agentInput: {
				cardId: issueKey,
				triggerCommentText: commentText,
				triggerCommentAuthor: authorName,
			},
			workItemId: issueKey,
			cardId: issueKey,
		};
	}
}
