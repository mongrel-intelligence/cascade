import { Args, Command, Flags } from '@oclif/core';
import { updatePRComment } from '../../gadgets/github/core/updatePRComment.js';

export default class UpdatePRComment extends Command {
	static override description = 'Update an existing comment on a GitHub pull request.';

	static override args = {
		commentId: Args.integer({ description: 'The comment ID', required: true }),
	};

	static override flags = {
		owner: Flags.string({ description: 'Repository owner', required: true }),
		repo: Flags.string({ description: 'Repository name', required: true }),
		body: Flags.string({ description: 'New comment body (markdown supported)', required: true }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(UpdatePRComment);
		const result = await updatePRComment(flags.owner, flags.repo, args.commentId, flags.body);
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
