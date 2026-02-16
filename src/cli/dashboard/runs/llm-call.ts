import { Args } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class RunsLlmCall extends DashboardCommand {
	static override description = 'Show a specific LLM call from an agent run.';

	static override args = {
		id: Args.string({ description: 'Run ID (UUID)', required: true }),
		callNumber: Args.integer({ description: 'LLM call number', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(RunsLlmCall);

		try {
			const call = await this.client.runs.getLlmCall.query({
				runId: args.id,
				callNumber: args.callNumber,
			});

			if (flags.json) {
				this.outputJson(call);
				return;
			}

			// Pretty-print the full LLM call details
			console.log(JSON.stringify(call, null, 2));
		} catch (err) {
			this.handleError(err);
		}
	}
}
