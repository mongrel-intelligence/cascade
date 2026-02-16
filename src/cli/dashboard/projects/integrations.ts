import { Args } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class ProjectsIntegrations extends DashboardCommand {
	static override description = 'Show integration configs for a project.';

	static override args = {
		id: Args.string({ description: 'Project ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(ProjectsIntegrations);

		try {
			const integrations = await this.client.projects.integrations.list.query({
				projectId: args.id,
			});

			if (flags.json) {
				this.outputJson(integrations);
				return;
			}

			if (!integrations || (Array.isArray(integrations) && integrations.length === 0)) {
				this.log('No integrations configured.');
				return;
			}

			for (const integration of integrations as unknown as Array<Record<string, unknown>>) {
				this.log(`\nType: ${integration.type}`);
				this.log(`Config: ${JSON.stringify(integration.config, null, 2)}`);
			}
		} catch (err) {
			this.handleError(err);
		}
	}
}
