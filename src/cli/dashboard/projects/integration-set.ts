import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class ProjectsIntegrationSet extends DashboardCommand {
	static override description = 'Create or update an integration config for a project.';

	static override args = {
		id: Args.string({ description: 'Project ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		category: Flags.string({
			description: 'Integration category (pm or scm)',
			required: true,
			options: ['pm', 'scm'],
		}),
		provider: Flags.string({
			description: 'Integration provider (trello, jira, github)',
			required: true,
		}),
		config: Flags.string({ description: 'Config as JSON string', required: true }),
		triggers: Flags.string({ description: 'Triggers as JSON string' }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(ProjectsIntegrationSet);

		let config: Record<string, unknown>;
		try {
			config = JSON.parse(flags.config) as Record<string, unknown>;
		} catch {
			this.error('Invalid JSON in --config flag.');
		}

		let triggers: Record<string, boolean> | undefined;
		if (flags.triggers) {
			try {
				triggers = JSON.parse(flags.triggers) as Record<string, boolean>;
			} catch {
				this.error('Invalid JSON in --triggers flag.');
			}
		}

		try {
			await this.withSpinner('Setting integration...', () =>
				this.client.projects.integrations.upsert.mutate({
					projectId: args.id,
					category: flags.category as 'pm' | 'scm',
					provider: flags.provider,
					config,
					triggers,
				}),
			);

			if (flags.json) {
				this.outputJson({ ok: true });
				return;
			}

			this.success(`Set ${flags.category}/${flags.provider} integration for project '${args.id}'`);
		} catch (err) {
			this.handleError(err);
		}
	}
}
