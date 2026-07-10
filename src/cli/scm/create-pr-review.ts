import { GITHUB_ACK_COMMENT_ID_ENV_VAR } from '../../backends/secretBuilder.js';
import {
	DEFAULT_REVIEW_EVENT_POLICY,
	REVIEW_EVENT_POLICY_ENV_VAR,
	type ReviewEvent,
	ReviewEventPolicySchema,
} from '../../config/reviewEventPolicy.js';
import { createPRReview } from '../../gadgets/github/core/createPRReview.js';
import { createPRReviewDef } from '../../gadgets/github/definitions.js';
import { writeReviewSidecar } from '../../gadgets/session/core/sidecar.js';
import { REVIEW_SIDECAR_ENV_VAR } from '../../gadgets/sessionState.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';
import { githubClient } from '../../github/client.js';

/**
 * Delete the GitHub ack/progress comment (best-effort).
 * Returns true if the comment was successfully deleted.
 */
async function deleteAckComment(owner: string, repo: string): Promise<boolean> {
	const ackCommentIdStr = process.env[GITHUB_ACK_COMMENT_ID_ENV_VAR];
	if (!ackCommentIdStr) return false;

	const ackCommentId = Number(ackCommentIdStr);
	if (!Number.isFinite(ackCommentId) || ackCommentId <= 0) return false;

	try {
		await githubClient.deletePRComment(owner, repo, ackCommentId);
		return true;
	} catch {
		return false;
	}
}

/** Resolve the review event policy injected by the router (absent/invalid → `all`). */
function resolveEventPolicyFromEnv() {
	const parsed = ReviewEventPolicySchema.safeParse(process.env[REVIEW_EVENT_POLICY_ENV_VAR]);
	return parsed.success ? parsed.data : DEFAULT_REVIEW_EVENT_POLICY;
}

export default createCLICommand(createPRReviewDef, async (params) => {
	const result = await createPRReview(
		{
			owner: params.owner as string,
			repo: params.repo as string,
			prNumber: params.prNumber as number,
			event: params.event as ReviewEvent,
			body: params.body as string,
			comments: params.comments as Array<{ path: string; line?: number; body: string }> | undefined,
		},
		{ eventPolicy: resolveEventPolicyFromEnv() },
	);

	// Delete ack comment (best-effort)
	const ackCommentDeleted = await deleteAckComment(params.owner as string, params.repo as string);

	// Record the SUBMITTED event/body — under comment-only these differ from the
	// requested params (the core downgrades to an advisory COMMENT).
	writeReviewSidecar(
		process.env[REVIEW_SIDECAR_ENV_VAR],
		result.reviewUrl,
		result.event,
		result.finalBody,
		ackCommentDeleted,
	);

	return result;
});
