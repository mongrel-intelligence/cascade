import { githubClient } from '../../../github/client.js';
import { type GitHubMutationResult, okResult, pickTimestamp } from './mutationResults.js';

/**
 * Structured result returned by `replyToReviewComment`. Extends
 * `GitHubMutationResult` with the parent-PR identity (`repoFullName`,
 * `prNumber`). The reply's `updatedAt` is preferred from GitHub's response;
 * we fall back to `createdAt` because some Octokit response shapes omit
 * `updated_at` on freshly-created review-comment replies.
 *
 * Failures throw (no prose sentinels). The CLI factory wraps thrown errors in
 * the spec-014 `runtime` envelope.
 */
export interface ReplyToReviewCommentResult extends GitHubMutationResult {
	repoFullName: string;
	prNumber: number;
}

export async function replyToReviewComment(
	owner: string,
	repo: string,
	prNumber: number,
	commentId: number,
	body: string,
): Promise<ReplyToReviewCommentResult> {
	const reply = await githubClient.replyToReviewComment(owner, repo, prNumber, commentId, body);
	return {
		...okResult({
			id: reply.id,
			updatedAt: pickTimestamp(reply.updatedAt ?? reply.createdAt),
			url: reply.htmlUrl,
		}),
		repoFullName: `${owner}/${repo}`,
		prNumber,
	};
}
