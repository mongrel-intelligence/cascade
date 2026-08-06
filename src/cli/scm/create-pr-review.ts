import { readFileSync } from 'node:fs';
import { GITHUB_ACK_COMMENT_ID_ENV_VAR } from '../../backends/secretBuilder.js';
import {
	DEFAULT_REVIEW_EVENT_POLICY,
	REVIEW_EVENT_POLICY_ENV_VAR,
	REVIEW_EVENT_POLICY_FILE,
	type ReviewEvent,
	type ReviewEventPolicy,
	ReviewEventPolicySchema,
} from '../../config/reviewEventPolicy.js';
import { createPRReview } from '../../gadgets/github/core/createPRReview.js';
import { createPRReviewDef } from '../../gadgets/github/definitions.js';
import { createMRReview } from '../../gadgets/gitlab/core/createMRReview.js';
import { writeReviewSidecar } from '../../gadgets/session/core/sidecar.js';
import { REVIEW_SIDECAR_ENV_VAR } from '../../gadgets/sessionState.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';
import { githubClient } from '../../github/client.js';
import { gitlabClient } from '../../gitlab/client.js';
import { detectSCMProvider, resolveProjectPath } from '../base.js';

/**
 * Delete the GitHub ack/progress comment (best-effort).
 * Returns true if the comment was successfully deleted.
 */
async function deleteGitHubAckComment(owner: string, repo: string): Promise<boolean> {
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

/**
 * Delete the GitLab ack/progress note (best-effort).
 * Returns true if the note was successfully deleted.
 */
async function deleteGitLabAckNote(projectPath: string, mrIid: number): Promise<boolean> {
	const ackNoteIdStr = process.env[GITHUB_ACK_COMMENT_ID_ENV_VAR];
	if (!ackNoteIdStr) return false;

	const ackNoteId = Number(ackNoteIdStr);
	if (!Number.isFinite(ackNoteId) || ackNoteId <= 0) return false;

	try {
		await gitlabClient.deleteMRNote(projectPath, mrIid, ackNoteId);
		return true;
	} catch {
		return false;
	}
}

/**
 * Resolve the review event policy for this run.
 *
 * Checks two sources in order:
 * 1. `CASCADE_REVIEW_EVENT_POLICY` env var — injected into the SDK env dict by
 *    `augmentProjectSecrets`. May be stripped by the claude subprocess chain.
 * 2. Policy file written to `/tmp/cascade-review-event-policy` by the worker
 *    process before the agent starts — survives subprocess env filtering.
 *
 * Absent/invalid in both sources → {@link DEFAULT_REVIEW_EVENT_POLICY}.
 */
function resolveEventPolicyFromEnv(): ReviewEventPolicy {
	const envParsed = ReviewEventPolicySchema.safeParse(process.env[REVIEW_EVENT_POLICY_ENV_VAR]);
	if (envParsed.success) return envParsed.data;

	try {
		const fileParsed = ReviewEventPolicySchema.safeParse(
			readFileSync(REVIEW_EVENT_POLICY_FILE, 'utf-8').trim(),
		);
		if (fileParsed.success) return fileParsed.data;
	} catch {
		// File absent or unreadable → default
	}

	return DEFAULT_REVIEW_EVENT_POLICY;
}

export default createCLICommand(createPRReviewDef, async (params) => {
	if (detectSCMProvider() === 'gitlab') {
		const projectPath = resolveProjectPath();
		const mrIid = params.prNumber as number;

		const result = await createMRReview({
			projectPath,
			mrIid,
			event: params.event as 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
			body: params.body as string,
		});

		// Delete ack note (best-effort)
		const ackCommentDeleted = await deleteGitLabAckNote(projectPath, mrIid);

		writeReviewSidecar(
			process.env[REVIEW_SIDECAR_ENV_VAR],
			`${projectPath}!${mrIid}`,
			params.event as string,
			params.body as string,
			ackCommentDeleted,
		);

		return result;
	}

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
	const ackCommentDeleted = await deleteGitHubAckComment(
		params.owner as string,
		params.repo as string,
	);

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
