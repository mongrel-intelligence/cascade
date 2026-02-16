import { Flags } from '@oclif/core';
import { getPRComments } from '../../gadgets/github/core/getPRComments.js';
import { CredentialScopedCommand } from '../base.js';

export default class GetPRComments extends CredentialScopedCommand {
	static override description = 'Get all review comments on a GitHub pull request.';

	static override flags = {
		owner: Flags.string({ description: 'Repository owner', required: true }),
		repo: Flags.string({ description: 'Repository name', required: true }),
		prNumber: Flags.integer({ description: 'The pull request number', required: true }),
	};

	async execute(): Promise<void> {
		const { flags } = await this.parse(GetPRComments);
		const result = await getPRComments(flags.owner, flags.repo, flags.prNumber);
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
