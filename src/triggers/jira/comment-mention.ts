/**
 * JIRA comment @mention trigger.
 *
 * Fires when someone @mentions the CASCADE bot user in a JIRA issue comment.
 * Runs the respond-to-planning-comment agent.
 */

import { resolveJiraTriggerEnabled } from '../../config/triggerConfig.js';
import { jiraClient } from '../../jira/client.js';
import { getJiraConfig } from '../../pm/config.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import type { JiraWebhookPayload } from './types.js';

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
 * Extract plain text from a comment body.
 * Handles both ADF objects (recursive extraction) and wiki markup strings.
 */
function extractText(body: unknown): string {
	if (typeof body === 'string') return body;
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
		return (node.content as unknown[]).map(extractText).join('');
	}

	return '';
}

/**
 * Check if a comment body contains an @mention for the given account ID.
 * Handles both ADF objects (type=mention nodes) and wiki markup strings
 * (pattern: [~accountid:{accountId}]).
 */
function hasMention(body: unknown, accountId: string, depth = 0): boolean {
	if (typeof body === 'string') {
		return body.includes(`[~accountid:${accountId}]`);
	}
	if (!body || typeof body !== 'object') return false;
	const node = body as Record<string, unknown>;

	if (node.type === 'mention' && typeof node.attrs === 'object') {
		const attrs = node.attrs as Record<string, unknown>;
		const isMatch = attrs.id === accountId;
		logger.info('ADF mention node found', {
			mentionId: attrs.id,
			lookingFor: accountId,
			isMatch,
			depth,
		});
		return isMatch;
	}

	if (Array.isArray(node.content)) {
		return (node.content as unknown[]).some((child) => hasMention(child, accountId, depth + 1));
	}

	return false;
}

export class JiraCommentMentionTrigger implements TriggerHandler {
	name = 'jira-comment-mention';
	description =
		'Triggers respond-to-planning-comment agent when someone @mentions the bot in a JIRA comment';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'jira') return false;

		// Check trigger config — default enabled for backward compatibility
		if (!resolveJiraTriggerEnabled(getJiraConfig(ctx.project)?.triggers, 'commentMention')) {
			return false;
		}

		const payload = ctx.payload as JiraWebhookPayload;
		return payload.webhookEvent === 'comment_created' || payload.webhookEvent === 'comment_updated';
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		const payload = ctx.payload as JiraWebhookPayload;
		const issueKey = payload.issue?.key;
		const commentBody = payload.comment?.body;
		const commentAuthor = payload.comment?.author;

		logger.info('JIRA comment trigger processing', {
			issueKey: issueKey ?? '<missing>',
			hasCommentBody: !!commentBody,
			commentAuthor: commentAuthor?.displayName ?? '<missing>',
			commentAuthorAccountId: commentAuthor?.accountId ?? '<missing>',
		});

		if (!issueKey || !commentBody) {
			logger.info('JIRA comment trigger: missing issueKey or commentBody, skipping', {
				hasIssueKey: !!issueKey,
				hasCommentBody: !!commentBody,
			});
			return null;
		}

		// Resolve our JIRA identity
		const userInfo = await getAuthenticatedUserInfo();
		logger.info('JIRA bot identity resolved', {
			botAccountId: userInfo.accountId,
			botDisplayName: userInfo.displayName,
		});

		// Check for @mention in comment body (ADF object or wiki markup string)
		const mentionFound = hasMention(commentBody, userInfo.accountId);
		if (!mentionFound) {
			// Log a truncated snapshot of the body so we can see the actual structure
			const bodySnapshot = JSON.stringify(commentBody);
			logger.info('JIRA comment trigger: no @mention of bot found in comment body', {
				issueKey,
				botAccountId: userInfo.accountId,
				bodySnapshot: bodySnapshot.length > 500 ? `${bodySnapshot.slice(0, 500)}...` : bodySnapshot,
			});
			return null;
		}

		// Skip self-authored comments to prevent infinite loops
		if (commentAuthor?.accountId === userInfo.accountId) {
			logger.info('Skipping self-authored JIRA comment to prevent infinite loop', {
				issueKey,
				accountId: userInfo.accountId,
			});
			return null;
		}

		const commentText = extractText(commentBody);
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
		};
	}
}
