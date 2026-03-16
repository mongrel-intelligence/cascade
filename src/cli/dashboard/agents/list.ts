import { Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class AgentsList extends DashboardCommand {
	static override description =
		'List enabled agent configurations for a project. Only agents with an explicit config row are shown (opt-in required).';

	static override flags = {
		...DashboardCommand.baseFlags,
		'project-id': Flags.string({ description: 'Project ID to list configs for', required: true }),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(AgentsList);

		try {
			const configs = await this.client.agentConfigs.list.query({
				projectId: flags['project-id'],
			});

			if (flags.json) {
				this.outputJson(configs);
				return;
			}

			if (configs.length === 0) {
				this.log('No agents enabled for this project. Use `cascade agents create` to enable one.');
				return;
			}

			this.outputTable(configs as unknown as Record<string, unknown>[], [
				{ key: 'id', header: 'ID' },
				{ key: 'agentType', header: 'Agent Type' },
				{ key: 'projectId', header: 'Project' },
				{ key: 'model', header: 'Model' },
				{ key: 'maxIterations', header: 'Max Iter' },
				{ key: 'agentEngine', header: 'Engine' },
				{ key: 'prompt', header: 'Prompt', format: (v) => (v ? 'custom' : '-') },
			]);
		} catch (err) {
			this.handleError(err);
		}
	}
}
