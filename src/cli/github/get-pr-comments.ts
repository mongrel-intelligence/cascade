import { Args, Command, Flags } from '@oclif/core';
import { getPRComments } from '../../gadgets/github/core/getPRComments.js';

export default class GetPRComments extends Command {
	static override description = 'Get all review comments on a GitHub pull request.';

	static override args = {
		prNumber: Args.integer({ description: 'The pull request number', required: true }),
	};

	static override flags = {
		owner: Flags.string({ description: 'Repository owner', required: true }),
		repo: Flags.string({ description: 'Repository name', required: true }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(GetPRComments);
		const result = await getPRComments(flags.owner, flags.repo, args.prNumber);
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
