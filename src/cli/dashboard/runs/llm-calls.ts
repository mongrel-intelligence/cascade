import { Args } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';
import { formatCost, formatDuration } from '../_shared/format.js';

export default class RunsLlmCalls extends DashboardCommand {
	static override description = 'List LLM calls for an agent run.';

	static override args = {
		id: Args.string({ description: 'Run ID (UUID)', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(RunsLlmCalls);

		try {
			const calls = await this.client.runs.listLlmCalls.query({ runId: args.id });

			if (flags.json) {
				this.outputJson(calls);
				return;
			}

			this.outputTable(calls as unknown as Record<string, unknown>[], [
				{ key: 'callNumber', header: '#' },
				{ key: 'model', header: 'Model' },
				{ key: 'inputTokens', header: 'In Tokens' },
				{ key: 'outputTokens', header: 'Out Tokens' },
				{ key: 'durationMs', header: 'Duration', format: formatDuration },
				{ key: 'costUsd', header: 'Cost', format: formatCost },
			]);
		} catch (err) {
			this.handleError(err);
		}
	}
}
