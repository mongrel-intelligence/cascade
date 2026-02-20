import { resolveGitHubTriggerEnabled } from '../../config/triggerConfig.js';
import { githubClient } from '../../github/client.js';
import { isCascadeBot } from '../../github/personas.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { isGitHubIssueCommentPayload, isGitHubPRReviewCommentPayload } from './types.js';
import { requireTrelloCardId } from './utils.js';

/**
 * Trigger that fires when someone @mentions the reviewer bot in a PR comment.
 * Handles both issue_comment.created (PR conversation) and pull_request_review_comment.created (inline).
 * Returns null (falls through) when there's no @mention, allowing existing triggers to handle the event.
 */
export class PRCommentMentionTrigger implements TriggerHandler {
	name = 'pr-comment-mention';
	description =
		'Triggers respond-to-pr-comment agent when someone @mentions the reviewer bot in a PR comment';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'github') return false;

		// Check trigger config — default enabled for backward compatibility
		if (!resolveGitHubTriggerEnabled(ctx.project.github?.triggers, 'prCommentMention')) {
			return false;
		}

		// Match issue_comment.created on PRs
		if (isGitHubIssueCommentPayload(ctx.payload)) {
			if (ctx.payload.action !== 'created') return false;
			return ctx.payload.issue.pull_request !== undefined;
		}

		// Match pull_request_review_comment.created
		if (isGitHubPRReviewCommentPayload(ctx.payload)) {
			return ctx.payload.action === 'created';
		}

		return false;
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		// Require persona identities for @mention detection
		if (!ctx.personaIdentities) {
			logger.warn('No persona identities available, skipping @mention trigger');
			return null;
		}

		// The implementer persona is who humans @mention (it writes code and responds)
		const mentionTarget = ctx.personaIdentities.implementer;

		// Extract comment body from whichever payload type matched
		let commentBody: string;
		let commentId: number;
		let commentUrl: string;
		let commentPath: string;
		let commentAuthor: string;
		let prNumber: number;
		let prBranch: string;
		let repoFullName: string;
		let prBody: string | null;

		if (isGitHubIssueCommentPayload(ctx.payload)) {
			const payload = ctx.payload;
			commentBody = payload.comment.body;
			commentId = payload.comment.id;
			commentUrl = payload.comment.html_url;
			commentPath = '';
			commentAuthor = payload.comment.user.login;
			prNumber = payload.issue.number;
			repoFullName = payload.repository.full_name;

			// Need to fetch PR for branch info and body
			const [owner, repo] = repoFullName.split('/');
			const prDetails = await githubClient.getPR(owner, repo, prNumber);
			prBranch = prDetails.headRef;
			prBody = prDetails.body;
		} else if (isGitHubPRReviewCommentPayload(ctx.payload)) {
			const payload = ctx.payload;
			commentBody = payload.comment.body;
			commentId = payload.comment.id;
			commentUrl = payload.comment.html_url;
			commentPath = payload.comment.path;
			commentAuthor = payload.comment.user.login;
			prNumber = payload.pull_request.number;
			prBranch = payload.pull_request.head.ref;
			repoFullName = payload.repository.full_name;

			// Fetch PR for body (needed for Trello card check)
			const [owner, repo] = repoFullName.split('/');
			const prDetails = await githubClient.getPR(owner, repo, prNumber);
			prBody = prDetails.body;
		} else {
			return null;
		}

		// Check for @mention of the implementer persona (case-insensitive)
		const mentionPattern = new RegExp(`@${mentionTarget}\\b`, 'i');
		if (!mentionPattern.test(commentBody)) {
			return null;
		}

		// Skip @mentions from any known bot persona
		if (isCascadeBot(commentAuthor, ctx.personaIdentities)) {
			logger.info('Skipping @mention from cascade bot', { prNumber, commentAuthor });
			return null;
		}

		// Require Trello card
		const cardId = requireTrelloCardId(prBody, {
			prNumber,
			triggerName: 'PR comment mention trigger',
		});
		if (cardId === null) return null;

		logger.info('PR comment @mention detected, triggering respond-to-pr-comment agent', {
			prNumber,
			commentAuthor,
			mentionTarget,
			cardId,
		});

		return {
			agentType: 'respond-to-pr-comment',
			agentInput: {
				prNumber,
				prBranch,
				repoFullName,
				triggerCommentId: commentId,
				triggerCommentBody: commentBody,
				triggerCommentPath: commentPath,
				triggerCommentUrl: commentUrl,
				commentAuthor,
			},
			prNumber,
			cardId: cardId || undefined,
		};
	}
}
