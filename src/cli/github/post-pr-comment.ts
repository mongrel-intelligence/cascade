import { Flags } from '@oclif/core';
import { postPRComment } from '../../gadgets/github/core/postPRComment.js';
import { CredentialScopedCommand, resolveOwnerRepo } from '../base.js';

export default class PostPRComment extends CredentialScopedCommand {
	static override description = 'Post a comment on a GitHub pull request.';

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
		body: Flags.string({ description: 'Comment body (markdown supported)', required: true }),
	};

	async execute(): Promise<void> {
		const { flags } = await this.parse(PostPRComment);
		const { owner, repo } = resolveOwnerRepo(flags.owner, flags.repo);
		const result = await postPRComment(owner, repo, flags.prNumber, flags.body);
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
