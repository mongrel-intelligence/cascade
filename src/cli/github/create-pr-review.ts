import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { Flags } from '@oclif/core';
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
				}),
			);
		} catch {
			// Best-effort — don't fail the review on sidecar write failure
		}

		this.log(JSON.stringify({ success: true, data: result }));
	}
}
