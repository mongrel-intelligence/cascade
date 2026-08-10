/**
 * JIRA comment @mention trigger.
 *
 * Fires when someone @mentions the CASCADE bot user in a JIRA issue comment
 * on an issue in the PLANNING status. Runs the respond-to-planning-comment agent.
 */

import { getJiraConfig } from '../../pm/config.js';
import { resolveJiraBotIdentity } from '../../router/bot-identity-resolvers.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { checkTriggerEnabled } from '../shared/trigger-check.js';
import type { JiraWebhookPayload } from './types.js';

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

/**
 * Check if the issue is in the configured PLANNING status.
 * Returns false (and logs) when the project has no planning status configured
 * or the issue's current status doesn't match.
 *
 * MNG-1768: the configured `planning` value is a locale-invariant status ID for
 * migrated configs (a status name for legacy configs). Match the ID first, then
 * fall back to a case-insensitive name comparison so both config shapes work.
 * Without the ID branch, an ID-based config (all new projects, plus any re-saved
 * project) would compare the localized `status.name` against a numeric ID and
 * silently never gate the comment-mention trigger.
 */
function isInPlanningStatus(
	project: TriggerContext['project'],
	issueKey: string,
	currentStatusId: string | undefined,
	currentStatusName: string | undefined,
): boolean {
	const configuredPlanningStatus = getJiraConfig(project)?.statuses.planning;
	if (!configuredPlanningStatus) {
		logger.debug(
			'Planning status not configured for JIRA project, skipping comment mention trigger',
			{ projectId: project.id },
		);
		return false;
	}
	const matchesId = currentStatusId !== undefined && currentStatusId === configuredPlanningStatus;
	const matchesName =
		currentStatusName !== undefined &&
		currentStatusName.toLowerCase() === configuredPlanningStatus.toLowerCase();
	if (!matchesId && !matchesName) {
		logger.debug('JIRA issue not in planning status, skipping comment mention trigger', {
			issueKey,
			currentStatusId,
			currentStatusName,
			planningStatus: configuredPlanningStatus,
		});
		return false;
	}
	return true;
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
		// Check trigger config via new DB-driven system
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

		// Resolve our JIRA identity using the shared per-project cached resolver
		const userInfo = await resolveJiraBotIdentity(ctx.project.id);
		if (!userInfo) {
			logger.warn('JIRA comment trigger: could not resolve bot user identity, skipping', {
				projectId: ctx.project.id,
			});
			return null;
		}
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

		// Gate on PLANNING status — only respond to comments on PLANNING issues.
		// MNG-1768: pass both the locale-invariant status ID and the localized
		// name so the gate matches ID-based configs and legacy name-based configs.
		const currentStatusId = payload.issue?.fields?.status?.id;
		const currentStatusName = payload.issue?.fields?.status?.name;
		if (!isInPlanningStatus(ctx.project, issueKey, currentStatusId, currentStatusName)) {
			return null;
		}
		const jiraConfig = getJiraConfig(ctx.project);

		const commentText = extractText(commentBody);
		const authorName = commentAuthor?.displayName || 'unknown';

		// Capture work item display data from the issue payload and Jira config
		const workItemUrl = jiraConfig?.baseUrl
			? `${jiraConfig.baseUrl}/browse/${issueKey}`
			: undefined;
		const workItemTitle = payload.issue?.fields?.summary ?? undefined;

		logger.info('JIRA comment @mention detected on PLANNING issue, triggering agent', {
			issueKey,
			commentAuthor: authorName,
			botAccountId: userInfo.accountId,
		});

		return {
			agentType: 'respond-to-planning-comment',
			agentInput: {
				workItemId: issueKey,
				triggerCommentBody: commentText,
				triggerCommentText: commentText, // @deprecated — use triggerCommentBody
				triggerCommentAuthor: authorName,
				workItemUrl,
				workItemTitle,
				triggerEvent: 'pm:comment-mention',
			},
			workItemId: issueKey,
			workItemUrl,
			workItemTitle,
		};
	}
}
