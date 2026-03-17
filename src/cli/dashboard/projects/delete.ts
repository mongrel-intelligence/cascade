import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';
import { confirm } from '../_shared/confirm.js';

export default class ProjectsDelete extends DashboardCommand {
	static override description = 'Delete a project.';

	static override args = {
		id: Args.string({ description: 'Project ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		yes: Flags.boolean({ description: 'Skip confirmation', char: 'y', default: false }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(ProjectsDelete);

		await confirm(`Delete project ${args.id}?`, flags.yes);

		try {
			await this.withSpinner('Deleting project...', () =>
				this.client.projects.delete.mutate({ id: args.id }),
			);

			if (flags.json) {
				this.outputJson({ ok: true });
				return;
			}

			this.success(`Deleted project '${args.id}'`);
		} catch (err) {
			this.handleError(err);
		}
	}
}
