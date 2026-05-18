import { Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class WorkflowStatusesCreate extends DashboardCommand {
	static override description = 'Create a custom workflow status definition.';

	static override flags = {
		...DashboardCommand.baseFlags,
		key: Flags.string({
			description: 'Workflow status key, e.g. prd or phased-plan',
			required: true,
		}),
		label: Flags.string({
			description: 'Human-readable status label, e.g. PRD',
			required: true,
		}),
		'agent-type': Flags.string({
			description: 'Agent type to dispatch for this status. Omit for no dispatch.',
		}),
		'sort-order': Flags.integer({
			description: 'Display order after built-in statuses',
		}),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(WorkflowStatusesCreate);

		try {
			const result = await this.withSpinner('Creating workflow status...', () =>
				this.client.workflowStatuses.create.mutate({
					key: flags.key,
					label: flags.label,
					agentType: flags['agent-type'],
					sortOrder: flags['sort-order'],
				}),
			);

			if (flags.json) {
				this.outputJson(result);
				return;
			}

			const agent = result.agentType ? ` -> ${result.agentType}` : ' -> no dispatch';
			this.success(`Created workflow status '${result.key}'${agent}`);
		} catch (err) {
			this.handleError(err);
		}
	}
}
