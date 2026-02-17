import { Flags } from '@oclif/core';
import { getPRDetails } from '../../gadgets/github/core/getPRDetails.js';
import { CredentialScopedCommand, resolveOwnerRepo } from '../base.js';

export default class GetPRDetails extends CredentialScopedCommand {
	static override description = 'Get details about a GitHub pull request.';

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
		const { flags } = await this.parse(GetPRDetails);
		const { owner, repo } = resolveOwnerRepo(flags.owner, flags.repo);
		const result = await getPRDetails(owner, repo, flags.prNumber);
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
