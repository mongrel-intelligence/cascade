import { Flags } from '@oclif/core';
import { getPRComments } from '../../gadgets/github/core/getPRComments.js';
import { CredentialScopedCommand, resolveOwnerRepo } from '../base.js';

export default class GetPRComments extends CredentialScopedCommand {
	static override description = 'Get all review comments on a GitHub pull request.';

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
	};

	async execute(): Promise<void> {
		const { flags } = await this.parse(GetPRComments);
		const { owner, repo } = resolveOwnerRepo(flags.owner, flags.repo);
		const result = await getPRComments(owner, repo, flags.prNumber);
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
