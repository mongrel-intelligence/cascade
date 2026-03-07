import { getPersonaForLogin } from '../../github/personas.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { checkTriggerEnabled } from '../shared/trigger-check.js';
import { isGitHubPullRequestReviewPayload } from './types.js';
import { resolveWorkItemId } from './utils.js';

export class PRReviewSubmittedTrigger implements TriggerHandler {
	name = 'pr-review-submitted';
	description = 'Triggers review agent when a PR review is submitted';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'github') return false;
		if (!isGitHubPullRequestReviewPayload(ctx.payload)) return false;

		// Only trigger on submitted reviews, not edits or dismissals
		if (ctx.payload.action !== 'submitted') return false;

		// Respond to changes_requested and commented reviews — not approved
		if (ctx.payload.review.state === 'approved') return false;

		return true;
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		// Check trigger config via new DB-driven system
		if (
			!(await checkTriggerEnabled(
				ctx.project.id,
				'respond-to-review',
				'scm:pr-review-submitted',
				this.name,
			))
		) {
			return null;
		}

		// Type assertion since we validated in matches()
		const reviewPayload = ctx.payload as {
			pull_request: { number: number; body: string | null; head: { ref: string } };
			repository: { full_name: string };
			review: {
				id: number;
				body: string | null;
				html_url: string;
				state: string;
				user: { login: string };
			};
		};

		const prNumber = reviewPayload.pull_request.number;
		const reviewAuthor = reviewPayload.review.user.login;

		// Only respond to reviews from the reviewer persona
		if (!ctx.personaIdentities) {
			logger.warn('No persona identities available, skipping review trigger', { prNumber });
			return null;
		}

		const persona = getPersonaForLogin(reviewAuthor, ctx.personaIdentities);
		if (persona !== 'reviewer') {
			logger.info('Skipping review not from reviewer persona', {
				prNumber,
				reviewAuthor,
				expectedReviewer: ctx.personaIdentities.reviewer,
			});
			return null;
		}

		// Resolve work item from DB (with PR body fallback)
		const prBody = reviewPayload.pull_request.body || '';
		const workItemId = await resolveWorkItemId(ctx.project.id, prNumber, prBody, ctx.project);

		logger.info('PR review submitted, triggering review agent', {
			prNumber,
			reviewState: reviewPayload.review.state,
			workItemId,
		});

		return {
			agentType: 'respond-to-review',
			agentInput: {
				prNumber,
				prBranch: reviewPayload.pull_request.head.ref,
				repoFullName: reviewPayload.repository.full_name,
				triggerCommentId: reviewPayload.review.id,
				triggerCommentBody: reviewPayload.review.body || `Review: ${reviewPayload.review.state}`,
				triggerCommentPath: '', // Reviews don't have a specific file path
				triggerCommentUrl: reviewPayload.review.html_url,
			},
			prNumber,
			workItemId,
		};
	}
}
