import { Args } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class RunsDebug extends DashboardCommand {
	static override description = 'Show debug analysis for an agent run.';

	static override args = {
		id: Args.string({ description: 'Run ID (UUID)', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(RunsDebug);

		try {
			const analysis = await this.client.runs.getDebugAnalysis.query({ runId: args.id });

			if (flags.json) {
				this.outputJson(analysis);
				return;
			}

			if (!analysis) {
				this.log('No debug analysis found for this run.');
				return;
			}

			console.log(JSON.stringify(analysis, null, 2));
		} catch (err) {
			this.handleError(err);
		}
	}
}
