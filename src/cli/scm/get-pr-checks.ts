import { Flags } from '@oclif/core';
import { getPRChecks } from '../../gadgets/github/core/getPRChecks.js';
import { CredentialScopedCommand, resolveOwnerRepo } from '../base.js';

export default class GetPRChecks extends CredentialScopedCommand {
	static override description = 'Get the CI check status for a GitHub pull request.';

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
		const { flags } = await this.parse(GetPRChecks);
		const { owner, repo } = resolveOwnerRepo(flags.owner, flags.repo);
		const result = await getPRChecks(owner, repo, flags.prNumber);
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
