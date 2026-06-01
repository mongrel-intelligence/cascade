import { githubClient } from '../../../github/client.js';
import { buildRunLinkFooterFromEnv } from '../../../utils/runLink.js';
import { type GitHubMutationResult, okResult } from './mutationResults.js';

/**
 * Structured result returned by `postPRComment`. Extends `GitHubMutationResult`
 * with the PR identity (`repoFullName`, `prNumber`) so structured-output consumers
 * (CLI sidecars, downstream review/respond flows) can correlate the comment
 * back to its parent PR without re-parsing the URL.
 *
 * Failures throw — there are NO prose sentinel strings here (MNG-1425).
 * `createCLICommand` wraps thrown errors in the spec-014 `runtime` envelope.
 */
export interface PostPRCommentResult extends GitHubMutationResult {
	repoFullName: string;
	prNumber: number;
}

export async function postPRComment(
	owner: string,
	repo: string,
	prNumber: number,
	body: string,
): Promise<PostPRCommentResult> {
	const runLinkFooter = buildRunLinkFooterFromEnv();
	const fullBody = runLinkFooter ? body + runLinkFooter : body;
	const created = await githubClient.createPRComment(owner, repo, prNumber, fullBody);
	return {
		...okResult({
			id: created.id,
			updatedAt: created.updatedAt,
			url: created.htmlUrl,
		}),
		repoFullName: `${owner}/${repo}`,
		prNumber,
	};
}
