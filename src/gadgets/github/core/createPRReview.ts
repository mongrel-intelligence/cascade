import {
	applyReviewEventPolicy,
	DEFAULT_REVIEW_EVENT_POLICY,
	type ReviewEvent,
	type ReviewEventPolicy,
} from '../../../config/reviewEventPolicy.js';
import { githubClient } from '../../../github/client.js';
import { buildRunLinkFooterFromEnv } from '../../../utils/runLink.js';
import { type GitHubMutationResult, okResult, pickTimestamp } from './mutationResults.js';

export interface CreatePRReviewParams {
	owner: string;
	repo: string;
	prNumber: number;
	event: ReviewEvent;
	body: string;
	comments?: Array<{ path: string; line?: number; body: string }>;
}

export interface CreatePRReviewOptions {
	/**
	 * Review event policy to enforce at submission time. Under `comment-only`
	 * the requested event is downgraded to `COMMENT` and the body gains an
	 * advisory verdict preamble. Defaults to `all` (no restriction).
	 */
	eventPolicy?: ReviewEventPolicy;
}

/**
 * Structured result returned by `createPRReview`. Extends
 * `GitHubMutationResult` with review-specific context — `reviewUrl` (alias of
 * `url` preserved for back-compat with the existing sidecar shape and
 * `recordReviewSubmission` callers), `event` (the ACTUALLY SUBMITTED action,
 * `APPROVE` / `REQUEST_CHANGES` / `COMMENT` — may differ from the requested
 * event under a comment-only policy, in which case `advisoryEvent` carries the
 * agent's original verdict), `finalBody` (the submitted body before the
 * run-link footer — advisory-preamble-led under comment-only), the PR identity,
 * the `submittedAt` timestamp, and the inline-comment count (zero when the
 * caller didn't pass any inline comments).
 *
 * Failures throw (no prose sentinels). The CLI factory wraps thrown errors in
 * the spec-014 `runtime` envelope; the gadget wrapper formats them for the
 * agent tool-result channel.
 */
export interface CreatePRReviewResult extends GitHubMutationResult {
	/** Alias of `url`, retained because existing sidecar/session-state code reads `reviewUrl`. */
	reviewUrl: string;
	event: ReviewEvent;
	/** The agent's original verdict, present only when the policy downgraded the submission. */
	advisoryEvent?: ReviewEvent;
	/** The submitted body before the run-link footer (advisory-preamble-led under comment-only). */
	finalBody: string;
	repoFullName: string;
	prNumber: number;
	/** GitHub-supplied `submitted_at`. Provider-supplied for submitted reviews. */
	submittedAt: string;
	inlineCommentCount: number;
}

export async function createPRReview(
	params: CreatePRReviewParams,
	options?: CreatePRReviewOptions,
): Promise<CreatePRReviewResult> {
	const applied = applyReviewEventPolicy(
		params.event,
		params.body,
		options?.eventPolicy ?? DEFAULT_REVIEW_EVENT_POLICY,
	);
	const runLinkFooter = buildRunLinkFooterFromEnv();
	const body = runLinkFooter ? applied.body + runLinkFooter : applied.body;

	const review = await githubClient.createPRReview(
		params.owner,
		params.repo,
		params.prNumber,
		applied.event,
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
		event: applied.event,
		...(applied.advisoryEvent !== undefined ? { advisoryEvent: applied.advisoryEvent } : {}),
		finalBody: applied.body,
		repoFullName: `${params.owner}/${params.repo}`,
		prNumber: params.prNumber,
		submittedAt,
		inlineCommentCount: params.comments?.length ?? 0,
	};
}
