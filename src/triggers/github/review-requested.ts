import { resolveGitHubTriggerEnabled } from '../../config/triggerConfig.js';
import { isCascadeBot } from '../../github/personas.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { type GitHubPullRequestPayload, isGitHubPullRequestPayload } from './types.js';
import { extractWorkItemId } from './utils.js';

/**
 * Trigger that fires the review agent when review is requested from a CASCADE persona account.
 *
 * This trigger:
 * 1. Fires on `pull_request.review_requested` events
 * 2. Checks if the requested reviewer is a CASCADE persona (implementer OR reviewer)
 * 3. Fires the `review` agent with PR number and work item ID from PR body
 *
 * Default: **disabled** (opt-in via trigger config). Enable by setting
 * `github.triggers.reviewRequested = true` in integration config.
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

		// Check trigger config — opt-in trigger, default disabled
		if (!resolveGitHubTriggerEnabled(ctx.project.github?.triggers, 'reviewRequested')) {
			return false;
		}

		return true;
	}

	resolveAgentType(): string {
		return 'review';
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		const payload = ctx.payload as GitHubPullRequestPayload;
		const prNumber = payload.pull_request.number;

		// Require persona identities for bot detection
		if (!ctx.personaIdentities) {
			logger.warn('No persona identities available, skipping review-requested trigger', {
				prNumber,
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

		const prBody = payload.pull_request.body;
		const workItemId = extractWorkItemId(prBody, ctx.project);

		if (!workItemId) {
			logger.info('PR does not have work item reference, skipping review-requested trigger', {
				prNumber,
			});
			return null;
		}

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
			cardId: workItemId,
			workItemId,
		};
	}
}
