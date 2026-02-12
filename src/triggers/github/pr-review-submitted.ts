import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { isGitHubPullRequestReviewPayload } from './types.js';
import { isSelfAuthored, requireTrelloCardId } from './utils.js';

export class PRReviewSubmittedTrigger implements TriggerHandler {
	name = 'pr-review-submitted';
	description = 'Triggers review agent when a PR review is submitted';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'github') return false;
		if (!isGitHubPullRequestReviewPayload(ctx.payload)) return false;

		// Only trigger on submitted reviews, not edits or dismissals
		if (ctx.payload.action !== 'submitted') return false;

		// Skip approval-only reviews - no point responding to these
		if (ctx.payload.review.state === 'approved') return false;

		return true;
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
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

		// Skip reviews from ourselves to avoid infinite loops
		if (
			await isSelfAuthored(reviewAuthor, { prNumber, authorField: 'reviewAuthor' }, ctx.project)
		) {
			return null;
		}

		// Check if PR has Trello card URL in body
		const prBody = reviewPayload.pull_request.body || '';
		const cardId = requireTrelloCardId(prBody, {
			prNumber,
			triggerName: 'review submission trigger',
		});
		if (cardId === null) return null;

		logger.info('PR review submitted, triggering review agent', {
			prNumber,
			reviewState: reviewPayload.review.state,
			cardId,
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
			cardId: cardId || undefined,
		};
	}
}
