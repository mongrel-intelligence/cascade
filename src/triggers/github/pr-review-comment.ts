import { githubClient } from '../../github/client.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { isGitHubPRReviewCommentPayload } from './types.js';
import { isAuthenticatedUser, requireTrelloCardId } from './utils.js';

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
			comment: {
				id: number;
				body: string;
				path: string;
				html_url: string;
				user: { login: string };
			};
		};

		const [owner, repo] = prPayload.repository.full_name.split('/');
		const prNumber = prPayload.pull_request.number;
		const commentAuthor = prPayload.comment.user.login;

		// Skip comments from ourselves (implementation user) to avoid loops
		if (await isAuthenticatedUser(commentAuthor)) {
			return null;
		}

		// Fetch PR to check for Trello card URL
		const prDetails = await githubClient.getPR(owner, repo, prNumber);

		const cardId = requireTrelloCardId(prDetails.body, {
			prNumber,
			triggerName: 'review comment trigger',
		});
		if (cardId === null) return null;

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
