import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class WorkflowStatusesUpdate extends DashboardCommand {
	static override description = 'Update a custom workflow status definition.';

	static override args = {
		key: Args.string({ description: 'Workflow status key', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		label: Flags.string({ description: 'New human-readable status label' }),
		'agent-type': Flags.string({
			description: 'Agent type to dispatch for this status',
			exclusive: ['no-agent'],
		}),
		'no-agent': Flags.boolean({
			description: 'Clear the dispatch agent for this status',
			exclusive: ['agent-type'],
			default: false,
		}),
		'sort-order': Flags.integer({ description: 'Display order' }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(WorkflowStatusesUpdate);

		if (
			flags.label === undefined &&
			flags['agent-type'] === undefined &&
			!flags['no-agent'] &&
			flags['sort-order'] === undefined
		) {
			this.error('Provide at least one of --label, --agent-type, --no-agent, or --sort-order.');
		}

		try {
			const result = await this.withSpinner('Updating workflow status...', () =>
				this.client.workflowStatuses.update.mutate({
					key: args.key,
					label: flags.label,
					agentType: flags['no-agent'] ? null : flags['agent-type'],
					sortOrder: flags['sort-order'],
				}),
			);

			if (flags.json) {
				this.outputJson(result);
				return;
			}

			const agent = result.agentType ? ` -> ${result.agentType}` : ' -> no dispatch';
			this.success(`Updated workflow status '${result.key}'${agent}`);
		} catch (err) {
			this.handleError(err);
		}
	}
}
