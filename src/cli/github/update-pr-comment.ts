import { Flags } from '@oclif/core';
import { updatePRComment } from '../../gadgets/github/core/updatePRComment.js';
import { CredentialScopedCommand, resolveOwnerRepo } from '../base.js';

export default class UpdatePRComment extends CredentialScopedCommand {
	static override description = 'Update an existing comment on a GitHub pull request.';

	static override flags = {
		owner: Flags.string({
			description: 'Repository owner (auto-detected)',
			env: 'CASCADE_REPO_OWNER',
		}),
		repo: Flags.string({
			description: 'Repository name (auto-detected)',
			env: 'CASCADE_REPO_NAME',
		}),
		commentId: Flags.integer({ description: 'The comment ID', required: true }),
		body: Flags.string({ description: 'New comment body (markdown supported)', required: true }),
	};

	async execute(): Promise<void> {
		const { flags } = await this.parse(UpdatePRComment);
		const { owner, repo } = resolveOwnerRepo(flags.owner, flags.repo);
		const result = await updatePRComment(owner, repo, flags.commentId, flags.body);
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
