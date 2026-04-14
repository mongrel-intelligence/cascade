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

import { resolveLinearCredentials } from '../../router/platformClients/index.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { checkTriggerEnabled } from '../shared/trigger-check.js';
import type { LinearWebhookCommentTriggerData, LinearWebhookTriggerPayload } from './types.js';

/**
 * Check if a Linear comment body contains an @mention for the given user ID.
 * Linear uses @[username](user:userId) markdown mention syntax.
 * We check for the userId in the mention pattern.
 */
function hasMention(body: string, userId: string): boolean {
	// Linear mentions use format: @[Display Name](userId)
	// The userId may appear inside a markdown link
	if (body.includes(userId)) return true;
	// Also check plain @username patterns (some clients may use simpler format)
	return false;
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

		// Resolve the bot's Linear user ID
		const creds = await resolveLinearCredentials(ctx.project.id);
		if (!creds) {
			logger.warn('Linear comment trigger: missing Linear credentials, skipping', {
				projectId: ctx.project.id,
			});
			return null;
		}

		// Fetch bot identity via viewer query
		const response = await fetch('https://api.linear.app/graphql', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${creds.apiKey}`,
			},
			body: JSON.stringify({ query: '{ viewer { id displayName } }' }),
		}).catch(() => null);

		if (!response?.ok) {
			logger.warn('Linear comment trigger: failed to resolve bot identity, skipping');
			return null;
		}

		const identityData = (await response.json()) as {
			data?: { viewer?: { id?: string; displayName?: string } };
		};
		const botUserId = identityData.data?.viewer?.id;
		const botDisplayName = identityData.data?.viewer?.displayName;

		if (!botUserId) {
			logger.warn('Linear comment trigger: could not resolve bot user ID, skipping');
			return null;
		}

		logger.info('Linear bot identity resolved', { botUserId, botDisplayName });

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
