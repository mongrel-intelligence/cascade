import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { Flags } from '@oclif/core';
import { GITHUB_ACK_COMMENT_ID_ENV_VAR } from '../../backends/secretBuilder.js';
import { createPRReview } from '../../gadgets/github/core/createPRReview.js';
import { REVIEW_SIDECAR_FILENAME } from '../../gadgets/sessionState.js';
import { CredentialScopedCommand, resolveOwnerRepo } from '../base.js';

export default class CreatePRReviewCommand extends CredentialScopedCommand {
	static override description = 'Submit a code review on a GitHub pull request.';

	static override flags = {
		owner: Flags.string({
			description: 'Repository owner (auto-detected)',
			env: 'CASCADE_REPO_OWNER',
		}),
		repo: Flags.string({
			description: 'Repository name (auto-detected)',
			env: 'CASCADE_REPO_NAME',
		}),
		prNumber: Flags.integer({ description: 'The pull request number', required: true }),
		event: Flags.string({
			description: 'Review action',
			required: true,
			options: ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'],
		}),
		body: Flags.string({ description: 'Review summary (markdown supported)', required: true }),
		comments: Flags.string({
			description: 'Inline comments as JSON array: [{"path":"file","line":1,"body":"comment"}]',
		}),
	};

	async execute(): Promise<void> {
		const { flags } = await this.parse(CreatePRReviewCommand);
		const { owner, repo } = resolveOwnerRepo(flags.owner, flags.repo);

		let comments: Array<{ path: string; line?: number; body: string }> | undefined;
		if (flags.comments) {
			comments = JSON.parse(flags.comments) as Array<{
				path: string;
				line?: number;
				body: string;
			}>;
		}

		const result = await createPRReview({
			owner,
			repo,
			prNumber: flags.prNumber,
			event: flags.event as 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
			body: flags.body,
			comments,
		});

		// Delete the GitHub ack/progress comment immediately after successful review submission.
		// This mirrors what the llmist backend's CreatePRReview gadget does via deleteInitialComment().
		// In the claude-code backend, the parent process cannot delete it in-process, so we do it here.
		let ackCommentDeleted = false;
		const ackCommentIdStr = process.env[GITHUB_ACK_COMMENT_ID_ENV_VAR];
		if (ackCommentIdStr) {
			const ackCommentId = Number(ackCommentIdStr);
			if (Number.isFinite(ackCommentId) && ackCommentId > 0) {
				try {
					const { githubClient } = await import('../../github/client.js');
					await githubClient.deletePRComment(owner, repo, ackCommentId);
					ackCommentDeleted = true;
				} catch {
					// Best-effort — deletion failure should not prevent the review from being reported
				}
			}
		}

		// Persist review data for the parent process (backend adapter)
		// to read and populate session state post-execution.
		try {
			const sidecarPath = join(process.cwd(), REVIEW_SIDECAR_FILENAME);
			mkdirSync(dirname(sidecarPath), { recursive: true });
			writeFileSync(
				sidecarPath,
				JSON.stringify({
					reviewUrl: result.reviewUrl,
					event: flags.event,
					body: flags.body,
					...(ackCommentDeleted && { ackCommentDeleted: true }),
				}),
			);
		} catch {
			// Best-effort — don't fail the review on sidecar write failure
		}

		this.log(JSON.stringify({ success: true, data: result }));
	}
}
