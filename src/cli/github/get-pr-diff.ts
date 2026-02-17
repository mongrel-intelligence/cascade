import { Flags } from '@oclif/core';
import { getPRDiff } from '../../gadgets/github/core/getPRDiff.js';
import { CredentialScopedCommand, resolveOwnerRepo } from '../base.js';

export default class GetPRDiff extends CredentialScopedCommand {
	static override description = 'Get the unified diff of all file changes in a GitHub PR.';

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
		const { flags } = await this.parse(GetPRDiff);
		const { owner, repo } = resolveOwnerRepo(flags.owner, flags.repo);
		const result = await getPRDiff(owner, repo, flags.prNumber);
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
