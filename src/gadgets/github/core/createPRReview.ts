import { githubClient } from '../../../github/client.js';
import { buildRunLinkFooterFromEnv } from '../../../utils/runLink.js';
import { type GitHubMutationResult, okResult, pickTimestamp } from './mutationResults.js';

export interface CreatePRReviewParams {
	owner: string;
	repo: string;
	prNumber: number;
	event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
	body: string;
	comments?: Array<{ path: string; line?: number; body: string }>;
}

/**
 * Structured result returned by `createPRReview`. Extends
 * `GitHubMutationResult` with review-specific context — `reviewUrl` (alias of
 * `url` preserved for back-compat with the existing sidecar shape and
 * `recordReviewSubmission` callers), `event` (the requested action,
 * `APPROVE` / `REQUEST_CHANGES` / `COMMENT`), the PR identity, the
 * `submittedAt` timestamp, and the inline-comment count (zero when the
 * caller didn't pass any inline comments).
 *
 * Failures throw (no prose sentinels). The CLI factory wraps thrown errors in
 * the spec-014 `runtime` envelope; the gadget wrapper formats them for the
 * agent tool-result channel.
 */
export interface CreatePRReviewResult extends GitHubMutationResult {
	/** Alias of `url`, retained because existing sidecar/session-state code reads `reviewUrl`. */
	reviewUrl: string;
	event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
	repoFullName: string;
	prNumber: number;
	/** GitHub-supplied `submitted_at`. Provider-supplied for submitted reviews. */
	submittedAt: string;
	inlineCommentCount: number;
}

export async function createPRReview(params: CreatePRReviewParams): Promise<CreatePRReviewResult> {
	const runLinkFooter = buildRunLinkFooterFromEnv();
	const body = runLinkFooter ? params.body + runLinkFooter : params.body;

	const review = await githubClient.createPRReview(
		params.owner,
		params.repo,
		params.prNumber,
		params.event,
		body,
		params.comments,
	);
	// submittedAt is nullable on the wire (GitHub returns null for PENDING
	// reviews); we always submit with an event, but defensively fall through
	// pickTimestamp so structured callers never see an empty timestamp.
	const submittedAt = pickTimestamp(review.submittedAt);
	return {
		...okResult({
			id: review.id,
			updatedAt: submittedAt,
			url: review.htmlUrl,
		}),
		reviewUrl: review.htmlUrl,
		event: params.event,
		repoFullName: `${params.owner}/${params.repo}`,
		prNumber: params.prNumber,
		submittedAt,
		inlineCommentCount: params.comments?.length ?? 0,
	};
}
