import { Flags } from '@oclif/core';
import { replyToReviewComment } from '../../gadgets/github/core/replyToReviewComment.js';
import { CredentialScopedCommand, resolveOwnerRepo } from '../base.js';

export default class ReplyToReviewComment extends CredentialScopedCommand {
	static override description = 'Reply to a specific review comment on a GitHub pull request.';

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
		'comment-id': Flags.integer({ description: 'The comment ID to reply to', required: true }),
		body: Flags.string({ description: 'Reply message (markdown supported)', required: true }),
	};

	async execute(): Promise<void> {
		const { flags } = await this.parse(ReplyToReviewComment);
		const { owner, repo } = resolveOwnerRepo(flags.owner, flags.repo);
		const result = await replyToReviewComment(
			owner,
			repo,
			flags.prNumber,
			flags['comment-id'],
			flags.body,
		);
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
