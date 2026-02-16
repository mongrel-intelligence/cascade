import { Flags } from '@oclif/core';
import { getPRChecks } from '../../gadgets/github/core/getPRChecks.js';
import { CredentialScopedCommand } from '../base.js';

export default class GetPRChecks extends CredentialScopedCommand {
	static override description = 'Get the CI check status for a GitHub pull request.';

	static override flags = {
		owner: Flags.string({ description: 'Repository owner', required: true }),
		repo: Flags.string({ description: 'Repository name', required: true }),
		prNumber: Flags.integer({ description: 'The pull request number', required: true }),
	};

	async execute(): Promise<void> {
		const { flags } = await this.parse(GetPRChecks);
		const result = await getPRChecks(flags.owner, flags.repo, flags.prNumber);
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
