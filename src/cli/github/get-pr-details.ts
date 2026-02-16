import { Flags } from '@oclif/core';
import { getPRDetails } from '../../gadgets/github/core/getPRDetails.js';
import { CredentialScopedCommand } from '../base.js';

export default class GetPRDetails extends CredentialScopedCommand {
	static override description = 'Get details about a GitHub pull request.';

	static override flags = {
		owner: Flags.string({ description: 'Repository owner', required: true }),
		repo: Flags.string({ description: 'Repository name', required: true }),
		prNumber: Flags.integer({ description: 'The pull request number', required: true }),
	};

	async execute(): Promise<void> {
		const { flags } = await this.parse(GetPRDetails);
		const result = await getPRDetails(flags.owner, flags.repo, flags.prNumber);
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
