import { Flags } from '@oclif/core';
import { getCIRunLogs } from '../../gadgets/github/core/getCIRunLogs.js';
import { CredentialScopedCommand, resolveOwnerRepo } from '../base.js';

export default class GetCIRunLogs extends CredentialScopedCommand {
	static override description = 'Get failed CI workflow run info for a commit.';

	static override flags = {
		owner: Flags.string({
			description: 'Repository owner (auto-detected)',
			env: 'CASCADE_REPO_OWNER',
		}),
		repo: Flags.string({
			description: 'Repository name (auto-detected)',
			env: 'CASCADE_REPO_NAME',
		}),
		ref: Flags.string({ description: 'The commit SHA or ref', required: true }),
	};

	async execute(): Promise<void> {
		const { flags } = await this.parse(GetCIRunLogs);
		const { owner, repo } = resolveOwnerRepo(flags.owner, flags.repo);
		const result = await getCIRunLogs(owner, repo, flags.ref);
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
