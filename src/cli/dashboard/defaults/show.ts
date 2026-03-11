import { DashboardCommand } from '../_shared/base.js';

export default class DefaultsShow extends DashboardCommand {
	static override description = 'Show organization defaults.';

	static override flags = {
		...DashboardCommand.baseFlags,
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(DefaultsShow);

		try {
			const defaults = await this.client.defaults.get.query();

			if (flags.json) {
				this.outputJson(defaults);
				return;
			}

			if (!defaults) {
				this.log('No defaults configured.');
				return;
			}

			this.outputDetail(defaults as unknown as Record<string, unknown>, {
				model: { label: 'Model' },
				maxIterations: { label: 'Max Iterations' },
				watchdogTimeoutMs: { label: 'Watchdog Timeout' },
				workItemBudgetUsd: { label: 'Card Budget' },
				agentBackend: { label: 'Agent Backend' },
				progressModel: { label: 'Progress Model' },
				progressIntervalMinutes: { label: 'Progress Interval' },
			});
		} catch (err) {
			this.handleError(err);
		}
	}
}
