import { GITHUB_ACK_COMMENT_ID_ENV_VAR } from '../../backends/secretBuilder.js';
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

export default createCLICommand(createPRReviewDef, async (params) => {
	const result = await createPRReview({
		owner: params.owner as string,
		repo: params.repo as string,
		prNumber: params.prNumber as number,
		event: params.event as 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
		body: params.body as string,
		comments: params.comments as Array<{ path: string; line?: number; body: string }> | undefined,
	});

	// Delete ack comment (best-effort)
	const ackCommentDeleted = await deleteAckComment(params.owner as string, params.repo as string);

	writeReviewSidecar(
		process.env[REVIEW_SIDECAR_ENV_VAR],
		result.reviewUrl,
		params.event as string,
		params.body as string,
		ackCommentDeleted,
	);

	return result;
});
