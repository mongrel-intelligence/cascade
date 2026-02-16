import { Flags } from '@oclif/core';
import { postPRComment } from '../../gadgets/github/core/postPRComment.js';
import { CredentialScopedCommand } from '../base.js';

export default class PostPRComment extends CredentialScopedCommand {
	static override description = 'Post a comment on a GitHub pull request.';

	static override flags = {
		owner: Flags.string({ description: 'Repository owner', required: true }),
		repo: Flags.string({ description: 'Repository name', required: true }),
		prNumber: Flags.integer({ description: 'The pull request number', required: true }),
		body: Flags.string({ description: 'Comment body (markdown supported)', required: true }),
	};

	async execute(): Promise<void> {
		const { flags } = await this.parse(PostPRComment);
		const result = await postPRComment(flags.owner, flags.repo, flags.prNumber, flags.body);
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
