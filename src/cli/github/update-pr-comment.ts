import { Flags } from '@oclif/core';
import { updatePRComment } from '../../gadgets/github/core/updatePRComment.js';
import { CredentialScopedCommand } from '../base.js';

export default class UpdatePRComment extends CredentialScopedCommand {
	static override description = 'Update an existing comment on a GitHub pull request.';

	static override flags = {
		owner: Flags.string({ description: 'Repository owner', required: true }),
		repo: Flags.string({ description: 'Repository name', required: true }),
		commentId: Flags.integer({ description: 'The comment ID', required: true }),
		body: Flags.string({ description: 'New comment body (markdown supported)', required: true }),
	};

	async execute(): Promise<void> {
		const { flags } = await this.parse(UpdatePRComment);
		const result = await updatePRComment(flags.owner, flags.repo, flags.commentId, flags.body);
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
