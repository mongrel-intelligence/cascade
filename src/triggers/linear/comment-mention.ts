/**
 * Linear comment @mention trigger.
 *
 * Fires when someone @mentions the CASCADE bot user in a Linear issue comment.
 * Runs the respond-to-planning-comment agent.
 *
 * Linear webhook structure for comment creation:
 *   action: 'create', type: 'Comment'
 *   data.body: the comment text (plain markdown)
 *   data.userId: the author's user ID
 *   data.issueId: the issue ID
 *   data.issue.identifier: the issue identifier (e.g. TEAM-123)
 */

import { resolveLinearBotUserId } from '../../router/bot-identity-resolvers.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { checkTriggerEnabled } from '../shared/trigger-check.js';
import type { LinearWebhookCommentTriggerData, LinearWebhookTriggerPayload } from './types.js';

/**
 * Check if a Linear comment body contains an @mention for the given user ID.
 * Linear uses @[Display Name](userId) markdown mention syntax, where userId is
 * a UUID. Checking for userId as a substring is sufficient and safe in practice.
 */
function hasMention(body: string, userId: string): boolean {
	return body.includes(userId);
}

export class LinearCommentMentionTrigger implements TriggerHandler {
	name = 'linear-comment-mention';
	description =
		'Triggers respond-to-planning-comment agent when someone @mentions the bot in a Linear comment';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'linear') return false;

		const payload = ctx.payload as LinearWebhookTriggerPayload;
		return payload.action === 'create' && payload.type === 'Comment';
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		// Check trigger config via DB-driven system
		if (
			!(await checkTriggerEnabled(
				ctx.project.id,
				'respond-to-planning-comment',
				'pm:comment-mention',
				this.name,
			))
		) {
			return null;
		}

		const payload = ctx.payload as LinearWebhookTriggerPayload;
		const data = payload.data as LinearWebhookCommentTriggerData;

		const commentBody = data.body;
		const commentAuthorId = data.userId;
		const issue = data.issue;
		const issueIdentifier = issue?.identifier ?? issue?.id;
		const issueId = issue?.id ?? data.issueId;

		logger.info('Linear comment trigger processing', {
			issueIdentifier: issueIdentifier ?? '<missing>',
			hasCommentBody: !!commentBody,
			commentAuthorId: commentAuthorId ?? '<missing>',
		});

		if (!issueIdentifier || !commentBody) {
			logger.info('Linear comment trigger: missing issueIdentifier or commentBody, skipping', {
				hasIssueIdentifier: !!issueIdentifier,
				hasCommentBody: !!commentBody,
			});
			return null;
		}

		// Resolve the bot's Linear user ID via the shared cached resolver
		const botUserId = await resolveLinearBotUserId(ctx.project.id);

		if (!botUserId) {
			logger.warn('Linear comment trigger: could not resolve bot user ID, skipping', {
				projectId: ctx.project.id,
			});
			return null;
		}

		logger.info('Linear bot identity resolved', { botUserId });

		// Skip self-authored comments to prevent infinite loops
		if (commentAuthorId === botUserId) {
			logger.info('Skipping self-authored Linear comment to prevent infinite loop', {
				issueIdentifier,
				botUserId,
			});
			return null;
		}

		// Check for bot @mention in comment body
		const mentionFound = hasMention(commentBody, botUserId);
		if (!mentionFound) {
			logger.info('Linear comment trigger: no @mention of bot found in comment body', {
				issueIdentifier,
				botUserId,
				bodyPreview: commentBody.length > 200 ? `${commentBody.slice(0, 200)}...` : commentBody,
			});
			return null;
		}

		const issueUrl = issue?.url;

		logger.info('Linear comment @mention detected, triggering agent', {
			issueIdentifier,
			commentAuthorId,
			botUserId,
		});

		return {
			agentType: 'respond-to-planning-comment',
			agentInput: {
				workItemId: issueIdentifier,
				triggerCommentText: commentBody,
				triggerCommentAuthor: commentAuthorId,
				workItemUrl: issueUrl,
				workItemTitle: undefined,
				triggerEvent: 'pm:comment-mention',
				linearIssueId: issueId,
			},
			workItemId: issueIdentifier,
			workItemUrl: issueUrl,
			workItemTitle: undefined,
		};
	}
}
