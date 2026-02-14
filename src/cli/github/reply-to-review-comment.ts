import { Args, Command, Flags } from '@oclif/core';
import { replyToReviewComment } from '../../gadgets/github/core/replyToReviewComment.js';

export default class ReplyToReviewComment extends Command {
	static override description = 'Reply to a specific review comment on a GitHub pull request.';

	static override args = {
		prNumber: Args.integer({ description: 'The pull request number', required: true }),
	};

	static override flags = {
		owner: Flags.string({ description: 'Repository owner', required: true }),
		repo: Flags.string({ description: 'Repository name', required: true }),
		'comment-id': Flags.integer({ description: 'The comment ID to reply to', required: true }),
		body: Flags.string({ description: 'Reply message (markdown supported)', required: true }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(ReplyToReviewComment);
		const result = await replyToReviewComment(
			flags.owner,
			flags.repo,
			args.prNumber,
			flags['comment-id'],
			flags.body,
		);
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
