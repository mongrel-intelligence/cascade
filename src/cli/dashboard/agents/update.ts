import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class AgentsUpdate extends DashboardCommand {
	static override description = 'Update an agent configuration.';

	static override args = {
		id: Args.integer({ description: 'Agent config ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		'agent-type': Flags.string({ description: 'Agent type' }),
		model: Flags.string({ description: 'Model override' }),
		'max-iterations': Flags.integer({ description: 'Max iterations override' }),
		engine: Flags.string({ description: 'Agent engine override' }),
		'max-concurrency': Flags.integer({ description: 'Max concurrent runs per project' }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(AgentsUpdate);

		try {
			await this.withSpinner('Updating agent config...', () =>
				this.client.agentConfigs.update.mutate({
					id: args.id,
					agentType: flags['agent-type'],
					model: flags.model,
					maxIterations: flags['max-iterations'],
					agentEngine: flags.engine,
					maxConcurrency: flags['max-concurrency'],
				}),
			);

			if (flags.json) {
				this.outputJson({ ok: true });
				return;
			}

			this.success(`Updated agent config #${args.id}`);
		} catch (err) {
			this.handleError(err);
		}
	}
}
