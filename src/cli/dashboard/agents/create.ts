import { Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class AgentsCreate extends DashboardCommand {
	static override description = 'Create an agent configuration for a project.';

	static override flags = {
		...DashboardCommand.baseFlags,
		'agent-type': Flags.string({
			description: 'Agent type (e.g. implementation, review)',
			required: true,
		}),
		'project-id': Flags.string({
			description: 'Project ID to scope the config to',
			required: true,
		}),
		model: Flags.string({ description: 'Model override' }),
		'max-iterations': Flags.integer({ description: 'Max iterations override' }),
		engine: Flags.string({ description: 'Agent engine override' }),
		'max-concurrency': Flags.integer({ description: 'Max concurrent runs per project' }),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(AgentsCreate);

		try {
			const result = await this.withSpinner('Creating agent config...', () =>
				this.client.agentConfigs.create.mutate({
					agentType: flags['agent-type'],
					projectId: flags['project-id'],
					model: flags.model,
					maxIterations: flags['max-iterations'],
					agentEngine: flags.engine,
					maxConcurrency: flags['max-concurrency'],
				}),
			);

			if (flags.json) {
				this.outputJson(result);
				return;
			}

			this.success(
				`Created agent config for '${flags['agent-type']}' on project '${flags['project-id']}'`,
			);
		} catch (err) {
			this.handleError(err);
		}
	}
}
