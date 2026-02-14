import { Args, Command, Flags } from '@oclif/core';
import { getPRDiff } from '../../gadgets/github/core/getPRDiff.js';

export default class GetPRDiff extends Command {
	static override description = 'Get the unified diff of all file changes in a GitHub PR.';

	static override args = {
		prNumber: Args.integer({ description: 'The pull request number', required: true }),
	};

	static override flags = {
		owner: Flags.string({ description: 'Repository owner', required: true }),
		repo: Flags.string({ description: 'Repository name', required: true }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(GetPRDiff);
		const result = await getPRDiff(flags.owner, flags.repo, args.prNumber);
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
