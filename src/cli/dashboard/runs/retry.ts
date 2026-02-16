import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class RunsRetry extends DashboardCommand {
	static override description = 'Retry a previous agent run.';

	static override args = {
		id: Args.string({ description: 'Run ID (UUID)', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		model: Flags.string({ description: 'Override model (optional)' }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(RunsRetry);

		try {
			const result = await this.client.runs.retry.mutate({
				runId: args.id,
				model: flags.model,
			});

			if (flags.json) {
				this.outputJson(result);
			} else {
				this.log('Run retry triggered successfully.');
			}
		} catch (err) {
			this.handleError(err);
		}
	}
}
