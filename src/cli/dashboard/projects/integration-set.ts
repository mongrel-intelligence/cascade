import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class ProjectsIntegrationSet extends DashboardCommand {
	static override description = 'Create or update an integration config for a project.';

	static override args = {
		id: Args.string({ description: 'Project ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		type: Flags.string({ description: 'Integration type (e.g. trello)', required: true }),
		config: Flags.string({ description: 'Config as JSON string', required: true }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(ProjectsIntegrationSet);

		let config: Record<string, unknown>;
		try {
			config = JSON.parse(flags.config) as Record<string, unknown>;
		} catch {
			this.error('Invalid JSON in --config flag.');
		}

		try {
			await this.client.projects.integrations.upsert.mutate({
				projectId: args.id,
				type: flags.type,
				config,
			});

			if (flags.json) {
				this.outputJson({ ok: true });
				return;
			}

			this.log(`Set ${flags.type} integration for project: ${args.id}`);
		} catch (err) {
			this.handleError(err);
		}
	}
}
