import { Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class AgentsList extends DashboardCommand {
	static override description = 'List agent configurations.';

	static override flags = {
		...DashboardCommand.baseFlags,
		'project-id': Flags.string({ description: 'Filter by project ID' }),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(AgentsList);

		try {
			const configs = await this.client.agentConfigs.list.query(
				flags['project-id'] ? { projectId: flags['project-id'] } : undefined,
			);

			if (flags.json) {
				this.outputJson(configs);
				return;
			}

			this.outputTable(configs as unknown as Record<string, unknown>[], [
				{ key: 'id', header: 'ID' },
				{ key: 'agentType', header: 'Agent Type' },
				{ key: 'projectId', header: 'Project', format: (v) => String(v ?? '(org)') },
				{ key: 'model', header: 'Model' },
				{ key: 'maxIterations', header: 'Max Iter' },
				{ key: 'agentBackend', header: 'Backend' },
			]);
		} catch (err) {
			this.handleError(err);
		}
	}
}
