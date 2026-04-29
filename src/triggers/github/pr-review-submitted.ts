import { getPersonaForLogin } from '../../github/personas.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { gateTriggerEnabled, requirePersonaIdentities } from '../shared/gates.js';
import { skip } from '../shared/skip.js';
import { type GitHubPullRequestReviewPayload, isGitHubPullRequestReviewPayload } from './types.js';
import { resolveWorkItemDisplayData, resolveWorkItemId } from './utils.js';

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
		const enabled = await gateTriggerEnabled(
			ctx.project.id,
			'respond-to-review',
			'scm:pr-review-submitted',
			this.name,
		);
		if (enabled) return enabled;

		// Type assertion since we validated in matches()
		const reviewPayload = ctx.payload as GitHubPullRequestReviewPayload;

		const prNumber = reviewPayload.pull_request.number;
		const reviewAuthor = reviewPayload.review.user.login;

		// Only respond to reviews from the reviewer persona (NOT general
		// cascade-bot — implementer reviews shouldn't trigger respond-to-review)
		const personasResult = requirePersonaIdentities(ctx.personaIdentities, prNumber, this.name);
		if (!personasResult.ok) return personasResult.skip;
		const personas = personasResult.value;

		const persona = getPersonaForLogin(reviewAuthor, personas);
		if (persona !== 'reviewer') {
			logger.info('Skipping review not from reviewer persona', {
				prNumber,
				reviewAuthor,
				expectedReviewer: personas.reviewer,
			});
			return skip(
				this.name,
				`Review on PR #${prNumber} authored by ${reviewAuthor}, not the reviewer persona — not auto-responding`,
			);
		}

		// Resolve work item from DB
		const workItemId = await resolveWorkItemId(ctx.project.id, prNumber);
		const { workItemUrl, workItemTitle } = await resolveWorkItemDisplayData(workItemId);

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
				headSha: reviewPayload.pull_request.head.sha,
				triggerEvent: 'scm:pr-review-submitted',
				triggerCommentId: reviewPayload.review.id,
				triggerCommentBody: reviewPayload.review.body || `Review: ${reviewPayload.review.state}`,
				triggerCommentPath: '', // Reviews don't have a specific file path
				triggerCommentUrl: reviewPayload.review.html_url,
				workItemId,
			},
			prNumber,
			prUrl: reviewPayload.pull_request.html_url,
			prTitle: reviewPayload.pull_request.title,
			workItemId,
			workItemUrl,
			workItemTitle,
		};
	}
}
