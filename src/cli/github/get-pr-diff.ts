import { Flags } from '@oclif/core';
import { getPRDiff } from '../../gadgets/github/core/getPRDiff.js';
import { CredentialScopedCommand } from '../base.js';

export default class GetPRDiff extends CredentialScopedCommand {
	static override description = 'Get the unified diff of all file changes in a GitHub PR.';

	static override flags = {
		owner: Flags.string({ description: 'Repository owner', required: true }),
		repo: Flags.string({ description: 'Repository name', required: true }),
		prNumber: Flags.integer({ description: 'The pull request number', required: true }),
	};

	async execute(): Promise<void> {
		const { flags } = await this.parse(GetPRDiff);
		const result = await getPRDiff(flags.owner, flags.repo, flags.prNumber);
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
