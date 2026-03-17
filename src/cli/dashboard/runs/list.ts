import { Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';
import { formatCost, formatDate, formatDuration, formatStatus } from '../_shared/format.js';

export default class RunsList extends DashboardCommand {
	static override description = 'List agent runs.';

	static override flags = {
		...DashboardCommand.baseFlags,
		project: Flags.string({ description: 'Filter by project ID' }),
		status: Flags.string({ description: 'Filter by status (comma-separated)' }),
		'agent-type': Flags.string({ description: 'Filter by agent type' }),
		limit: Flags.integer({ description: 'Number of results', default: 50 }),
		offset: Flags.integer({ description: 'Offset for pagination', default: 0 }),
		sort: Flags.string({
			description: 'Sort field',
			options: ['startedAt', 'durationMs', 'costUsd'],
			default: 'startedAt',
		}),
		order: Flags.string({ description: 'Sort order', options: ['asc', 'desc'], default: 'desc' }),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(RunsList);

		try {
			const runs = await this.client.runs.list.query({
				projectId: flags.project,
				status: flags.status?.split(','),
				agentType: flags['agent-type'],
				limit: flags.limit,
				offset: flags.offset,
				sort: flags.sort as 'startedAt' | 'durationMs' | 'costUsd',
				order: flags.order as 'asc' | 'desc',
			});

			const { data, total } = runs as { data: Record<string, unknown>[]; total: number };

			const columns = [
				{ key: 'id', header: 'ID', format: (v: unknown) => String(v ?? '').slice(0, 8) },
				{ key: 'projectId', header: 'Project' },
				{ key: 'agentType', header: 'Agent' },
				{ key: 'status', header: 'Status', format: formatStatus },
				{ key: 'startedAt', header: 'Started', format: formatDate },
				{ key: 'durationMs', header: 'Duration', format: formatDuration },
				{ key: 'costUsd', header: 'Cost', format: formatCost },
			];

			this.outputFormatted(
				data,
				columns,
				flags,
				runs,
				'No runs found. Try `cascade runs trigger --project <id> --agent-type <type>`',
			);

			const fmt = this.resolveFormat(flags);
			if (fmt === 'table' && total > data.length) {
				this.log(`\nShowing ${data.length} of ${total} runs.`);
			}
		} catch (err) {
			this.handleError(err);
		}
	}
}
