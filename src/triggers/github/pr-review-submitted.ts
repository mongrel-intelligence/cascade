import { getAuthenticatedUser } from '../../github/client.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { isGitHubPullRequestReviewPayload } from './types.js';
import { extractTrelloCardId, hasTrelloCardUrl } from './utils.js';

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
		try {
			const authenticatedUser = await getAuthenticatedUser();
			if (reviewAuthor === authenticatedUser || reviewAuthor === `${authenticatedUser}[bot]`) {
				logger.info('Skipping self-authored review', {
					prNumber,
					reviewAuthor,
					authenticatedUser,
				});
				return null;
			}
		} catch (err) {
			logger.warn('Failed to get authenticated user, proceeding with caution', {
				error: String(err),
			});
		}

		// Check if PR has Trello card URL in body
		const prBody = reviewPayload.pull_request.body || '';
		if (!hasTrelloCardUrl(prBody)) {
			logger.info('PR does not have Trello card URL, skipping review submission trigger', {
				prNumber,
				reviewState: reviewPayload.review.state,
			});
			return null;
		}

		const cardId = extractTrelloCardId(prBody);

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
