import { Args } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';
import { formatCost, formatDate, formatDuration, formatStatus } from '../_shared/format.js';

export default class RunsShow extends DashboardCommand {
	static override description = 'Show details of an agent run.';

	static override args = {
		id: Args.string({ description: 'Run ID (UUID)', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(RunsShow);

		try {
			const run = await this.client.runs.getById.query({ id: args.id });

			if (flags.json) {
				this.outputJson(run);
				return;
			}

			this.outputDetail(run as unknown as Record<string, unknown>, {
				id: { label: 'ID' },
				projectId: { label: 'Project' },
				agentType: { label: 'Agent Type' },
				status: { label: 'Status', format: formatStatus },
				startedAt: { label: 'Started', format: formatDate },
				durationMs: { label: 'Duration', format: formatDuration },
				costUsd: { label: 'Cost', format: formatCost },
				workItemId: { label: 'Work Item ID' },
				cardName: { label: 'Card Name' },
				iterations: { label: 'Iterations' },
				llmCalls: { label: 'LLM Calls' },
				errorMessage: { label: 'Error' },
			});
		} catch (err) {
			this.handleError(err);
		}
	}
}
