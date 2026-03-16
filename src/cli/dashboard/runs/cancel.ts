import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class RunsCancel extends DashboardCommand {
	static override description = 'Cancel a running agent run (marks it as failed).';

	static override args = {
		id: Args.string({ description: 'Run ID (UUID)', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		reason: Flags.string({
			description: 'Reason for cancellation',
			default: 'Manually cancelled via CLI',
		}),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(RunsCancel);

		try {
			const result = await this.withSpinner('Cancelling run...', () =>
				this.client.runs.cancel.mutate({
					runId: args.id,
					reason: flags.reason,
				}),
			);

			if (flags.json) {
				this.outputJson(result);
			} else {
				this.success(`Cancelled run ${args.id}`);
			}
		} catch (err) {
			this.handleError(err);
		}
	}
}
