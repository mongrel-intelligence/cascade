import { DashboardCommand } from '../_shared/base.js';

export default class WorkflowStatusesList extends DashboardCommand {
	static override description = 'List built-in and custom workflow statuses.';

	static override flags = {
		...DashboardCommand.baseFlags,
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(WorkflowStatusesList);

		try {
			const statuses = await this.client.workflowStatuses.list.query();
			const rows = statuses.map((status) => ({
				key: status.key,
				label: status.label,
				agentType: status.agentType ?? '',
				sortOrder: status.sortOrder,
				isBuiltin: status.isBuiltin,
			}));
			const columns = [
				{ key: 'key', header: 'Key' },
				{ key: 'label', header: 'Label' },
				{ key: 'agentType', header: 'Agent Type' },
				{ key: 'sortOrder', header: 'Order' },
				{
					key: 'isBuiltin',
					header: 'Built-in',
					format: (value: unknown) => (value ? 'yes' : 'no'),
				},
			];

			this.outputFormatted(rows, columns, flags, statuses, 'No workflow statuses found.');
		} catch (err) {
			this.handleError(err);
		}
	}
}
