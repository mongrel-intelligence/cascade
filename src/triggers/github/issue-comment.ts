import { githubClient } from '../../github/client.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { isGitHubIssueCommentPayload } from './types.js';
import { isSelfAuthored, requireTrelloCardId } from './utils.js';

export class IssueCommentTrigger implements TriggerHandler {
	name = 'issue-comment-created';
	description = 'Triggers respond-to-review agent when a PR receives a new conversation comment';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'github') return false;
		if (!isGitHubIssueCommentPayload(ctx.payload)) return false;

		// Only trigger on new comments, not edits or deletes
		if (ctx.payload.action !== 'created') return false;

		// Only trigger for PRs (issues with pull_request field)
		return ctx.payload.issue.pull_request !== undefined;
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		const payload = ctx.payload as {
			issue: { number: number; pull_request?: { url: string } };
			comment: { id: number; body: string; html_url: string; user: { login: string } };
			repository: { full_name: string };
			sender: { login: string };
		};

		const prNumber = payload.issue.number;
		const commentAuthor = payload.comment.user.login;
		const [owner, repo] = payload.repository.full_name.split('/');

		// Skip comments from ourselves to avoid infinite loops
		if (
			await isSelfAuthored(commentAuthor, { prNumber, authorField: 'commentAuthor' }, ctx.project)
		) {
			return null;
		}

		// Fetch PR to check for Trello card URL and get branch info
		const prDetails = await githubClient.getPR(owner, repo, prNumber);

		const cardId = requireTrelloCardId(prDetails.body, {
			prNumber,
			triggerName: 'issue comment trigger',
		});
		if (cardId === null) return null;

		logger.info('PR issue comment received, triggering respond-to-review agent', {
			prNumber,
			commentAuthor,
			cardId,
		});

		return {
			agentType: 'respond-to-review',
			agentInput: {
				prNumber,
				prBranch: prDetails.headRef,
				repoFullName: payload.repository.full_name,
				triggerCommentId: payload.comment.id,
				triggerCommentBody: payload.comment.body,
				triggerCommentPath: '', // Issue comments don't have a specific file path
				triggerCommentUrl: payload.comment.html_url,
			},
			prNumber,
			cardId: cardId || undefined,
		};
	}
}
