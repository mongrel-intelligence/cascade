import { Args } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class ProjectsOverrides extends DashboardCommand {
	static override description = 'Show credential overrides for a project.';

	static override args = {
		id: Args.string({ description: 'Project ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(ProjectsOverrides);

		try {
			const overrides = await this.client.projects.credentialOverrides.list.query({
				projectId: args.id,
			});

			if (flags.json) {
				this.outputJson(overrides);
				return;
			}

			if (!overrides || (Array.isArray(overrides) && overrides.length === 0)) {
				this.log('No credential overrides configured.');
				return;
			}

			this.outputTable(overrides as unknown as Record<string, unknown>[], [
				{ key: 'envVarKey', header: 'Key' },
				{ key: 'credentialId', header: 'Credential ID' },
				{ key: 'agentType', header: 'Agent Type', format: (v) => String(v ?? '(all)') },
			]);
		} catch (err) {
			this.handleError(err);
		}
	}
}
