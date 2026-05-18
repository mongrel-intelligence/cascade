import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class WorkflowStatusesDelete extends DashboardCommand {
	static override description = 'Delete a custom workflow status definition.';

	static override args = {
		key: Args.string({ description: 'Workflow status key', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		yes: Flags.boolean({ description: 'Skip confirmation', char: 'y', default: false }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(WorkflowStatusesDelete);

		if (!flags.yes) {
			this.error('Pass --yes to confirm deletion.');
		}

		try {
			const result = await this.withSpinner('Deleting workflow status...', () =>
				this.client.workflowStatuses.delete.mutate({ key: args.key }),
			);

			if (flags.json) {
				this.outputJson(result);
				return;
			}

			this.success(`Deleted workflow status '${result.key}'`);
		} catch (err) {
			this.handleError(err);
		}
	}
}
