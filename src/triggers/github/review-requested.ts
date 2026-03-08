import { isCascadeBot } from '../../github/personas.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { checkTriggerEnabled } from '../shared/trigger-check.js';
import { type GitHubPullRequestPayload, isGitHubPullRequestPayload } from './types.js';
import { resolveWorkItemId } from './utils.js';

/**
 * Trigger that fires the review agent when review is requested from a CASCADE persona account.
 *
 * This trigger:
 * 1. Fires on `pull_request.review_requested` events
 * 2. Rejects requests sent by CASCADE personas (loop prevention)
 * 3. Checks if the requested reviewer is a CASCADE persona (implementer OR reviewer)
 * 4. Fires the `review` agent with PR number and work item ID from PR body
 *
 * Default: **disabled** (opt-in via trigger config).
 *
 * Registration: should be registered BEFORE CheckSuiteSuccessTrigger so that
 * both triggers can independently fire review. The HEAD-SHA dedup in
 * CheckSuiteSuccessTrigger prevents double-reviews.
 */
export class ReviewRequestedTrigger implements TriggerHandler {
	name = 'review-requested';
	description = 'Triggers review agent when review is requested from a CASCADE persona account';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'github') return false;
		if (!isGitHubPullRequestPayload(ctx.payload)) return false;

		// Only trigger on review_requested events
		if (ctx.payload.action !== 'review_requested') return false;

		return true;
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		// Check trigger config via new DB-driven system
		if (!(await checkTriggerEnabled(ctx.project.id, 'review', 'scm:review-requested', this.name))) {
			return null;
		}

		const payload = ctx.payload as GitHubPullRequestPayload;
		const prNumber = payload.pull_request.number;

		// Require persona identities for bot detection
		if (!ctx.personaIdentities) {
			logger.warn('No persona identities available, skipping review-requested trigger', {
				prNumber,
			});
			return null;
		}

		// Skip review requests FROM CASCADE personas (self-loop prevention)
		const senderLogin = payload.sender.login;
		if (isCascadeBot(senderLogin, ctx.personaIdentities)) {
			logger.info('Skipping review request from CASCADE persona (loop prevention)', {
				prNumber,
				sender: senderLogin,
				requestedReviewer: payload.requested_reviewer?.login,
			});
			return null;
		}

		// Check if the requested reviewer is a CASCADE persona
		const requestedReviewer = payload.requested_reviewer?.login;
		if (!requestedReviewer) {
			logger.debug('No requested reviewer in payload, skipping', { prNumber });
			return null;
		}

		if (!isCascadeBot(requestedReviewer, ctx.personaIdentities)) {
			logger.debug('Requested reviewer is not a CASCADE persona, skipping', {
				prNumber,
				requestedReviewer,
				personas: ctx.personaIdentities,
			});
			return null;
		}

		// Resolve work item from DB (with PR body fallback)
		const prBody = payload.pull_request.body;
		const workItemId = await resolveWorkItemId(ctx.project.id, prNumber, prBody, ctx.project);

		logger.info('Review requested from CASCADE persona, triggering review agent', {
			prNumber,
			requestedReviewer,
			workItemId,
		});

		return {
			agentType: 'review',
			agentInput: {
				prNumber,
				prBranch: payload.pull_request.head.ref,
				repoFullName: payload.repository.full_name,
				headSha: payload.pull_request.head.sha,
				triggerType: 'review-requested',
				cardId: workItemId,
			},
			prNumber,
			workItemId,
		};
	}
}
