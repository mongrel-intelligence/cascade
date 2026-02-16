import { Args } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class RunsLogs extends DashboardCommand {
	static override description = 'Show logs for an agent run.';

	static override args = {
		id: Args.string({ description: 'Run ID (UUID)', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(RunsLogs);

		try {
			const logs = await this.client.runs.getLogs.query({ runId: args.id });

			if (flags.json) {
				this.outputJson(logs);
				return;
			}

			if (!logs || (Array.isArray(logs) && logs.length === 0)) {
				this.log('No logs found.');
				return;
			}

			// Output raw log content for piping
			if (typeof logs === 'string') {
				console.log(logs);
			} else if (Array.isArray(logs)) {
				for (const entry of logs) {
					console.log(typeof entry === 'string' ? entry : JSON.stringify(entry));
				}
			} else {
				console.log(JSON.stringify(logs, null, 2));
			}
		} catch (err) {
			this.handleError(err);
		}
	}
}
