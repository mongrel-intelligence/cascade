import { Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class DefaultsSet extends DashboardCommand {
	static override description = 'Set organization defaults.';

	static override flags = {
		...DashboardCommand.baseFlags,
		model: Flags.string({ description: 'Default model' }),
		'max-iterations': Flags.integer({ description: 'Max iterations per agent run' }),
		'fresh-machine-timeout': Flags.integer({ description: 'Fresh machine timeout (ms)' }),
		'watchdog-timeout': Flags.integer({ description: 'Watchdog timeout (ms)' }),
		'post-job-grace': Flags.integer({ description: 'Post-job grace period (ms)' }),
		'card-budget': Flags.string({ description: 'Per-card budget in USD' }),
		'agent-backend': Flags.string({ description: 'Default agent backend' }),
		'progress-model': Flags.string({ description: 'Model for progress updates' }),
		'progress-interval': Flags.string({ description: 'Progress update interval (minutes)' }),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(DefaultsSet);

		try {
			await this.client.defaults.upsert.mutate({
				model: flags.model,
				maxIterations: flags['max-iterations'],
				freshMachineTimeoutMs: flags['fresh-machine-timeout'],
				watchdogTimeoutMs: flags['watchdog-timeout'],
				postJobGracePeriodMs: flags['post-job-grace'],
				cardBudgetUsd: flags['card-budget'],
				agentBackend: flags['agent-backend'],
				progressModel: flags['progress-model'],
				progressIntervalMinutes: flags['progress-interval'],
			});

			if (flags.json) {
				this.outputJson({ ok: true });
				return;
			}

			this.log('Defaults updated.');
		} catch (err) {
			this.handleError(err);
		}
	}
}
