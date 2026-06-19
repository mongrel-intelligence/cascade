import { githubClient } from '../../../github/client.js';
import { type GitHubMutationResult, okResult } from './mutationResults.js';

/**
 * Structured result returned by `updatePRComment`. Extends
 * `GitHubMutationResult` with the parent-PR identity (`repoFullName`,
 * `prNumber`). `prNumber` is included for parity with `postPRComment` and
 * `replyToReviewComment`; we recover it from the comment URL because the
 * issue-comment update API doesn't echo the issue number on the response.
 *
 * Failures throw (no prose sentinels). The CLI factory wraps thrown errors in
 * the spec-014 `runtime` envelope.
 */
export interface UpdatePRCommentResult extends GitHubMutationResult {
	repoFullName: string;
	prNumber: number | null;
}

const PR_NUMBER_FROM_HTML_URL_REGEX = /\/pull\/(\d+)/;

function extractPRNumberFromHtmlUrl(htmlUrl: string): number | null {
	const match = htmlUrl.match(PR_NUMBER_FROM_HTML_URL_REGEX);
	if (!match) return null;
	const n = Number.parseInt(match[1], 10);
	return Number.isFinite(n) ? n : null;
}

export async function updatePRComment(
	owner: string,
	repo: string,
	commentId: number,
	body: string,
): Promise<UpdatePRCommentResult> {
	const updated = await githubClient.updatePRComment(owner, repo, commentId, body);
	return {
		...okResult({
			id: updated.id,
			updatedAt: updated.updatedAt,
			url: updated.htmlUrl,
		}),
		repoFullName: `${owner}/${repo}`,
		prNumber: extractPRNumberFromHtmlUrl(updated.htmlUrl),
	};
}
