import { githubClient } from '../../github/client.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { isGitHubPRReviewCommentPayload } from './types.js';
import { extractTrelloCardId, hasTrelloCardUrl } from './utils.js';

export class PRReviewCommentTrigger implements TriggerHandler {
	name = 'pr-review-comment-created';
	description = 'Triggers review agent when a PR receives a new review comment';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'github') return false;
		if (!isGitHubPRReviewCommentPayload(ctx.payload)) return false;

		// Only trigger on new comments, not edits or deletes
		return ctx.payload.action === 'created';
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		// Type assertion since we validated in matches()
		const prPayload = ctx.payload as {
			pull_request: { number: number; head: { ref: string } };
			repository: { full_name: string };
			comment: { id: number; body: string; path: string; html_url: string };
		};

		const [owner, repo] = prPayload.repository.full_name.split('/');
		const prNumber = prPayload.pull_request.number;

		// Fetch PR to check for Trello card URL
		const prDetails = await githubClient.getPR(owner, repo, prNumber);

		if (!hasTrelloCardUrl(prDetails.body)) {
			logger.info('PR does not have Trello card URL, skipping review comment trigger', {
				prNumber,
			});
			return null;
		}

		const cardId = extractTrelloCardId(prDetails.body);

		return {
			agentType: 'respond-to-review',
			agentInput: {
				prNumber,
				prBranch: prPayload.pull_request.head.ref,
				repoFullName: prPayload.repository.full_name,
				triggerCommentId: prPayload.comment.id,
				triggerCommentBody: prPayload.comment.body,
				triggerCommentPath: prPayload.comment.path,
				triggerCommentUrl: prPayload.comment.html_url,
			},
			prNumber,
			cardId: cardId || undefined,
		};
	}
}
