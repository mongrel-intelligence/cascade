import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';
import { confirm } from '../_shared/confirm.js';

export default class ProjectsIntegrationDelete extends DashboardCommand {
	static override description = 'Delete an integration config for a project.';

	static override args = {
		id: Args.string({ description: 'Project ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		category: Flags.string({
			description: 'Integration category (pm, scm, or alerting)',
			required: true,
			options: ['pm', 'scm', 'alerting'],
		}),
		yes: Flags.boolean({ description: 'Skip confirmation', char: 'y', default: false }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(ProjectsIntegrationDelete);

		await confirm(`Delete ${flags.category} integration from project ${args.id}?`, flags.yes);

		try {
			await this.withSpinner('Deleting integration...', () =>
				this.client.projects.integrations.delete.mutate({
					projectId: args.id,
					category: flags.category as 'pm' | 'scm' | 'alerting',
				}),
			);

			if (flags.json) {
				this.outputJson({ ok: true });
				return;
			}

			this.success(`Deleted ${flags.category} integration from project '${args.id}'`);
		} catch (err) {
			this.handleError(err);
		}
	}
}
