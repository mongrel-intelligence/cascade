import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class ProjectsCredentialsDelete extends DashboardCommand {
	static override description = 'Delete a project-scoped credential.';

	static override args = {
		id: Args.string({ description: 'Project ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		key: Flags.string({
			description: 'Environment variable key to delete',
			required: true,
		}),
		yes: Flags.boolean({ description: 'Skip confirmation', char: 'y', default: false }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(ProjectsCredentialsDelete);

		if (!flags.yes) {
			this.error('Pass --yes to confirm deletion.');
		}

		try {
			await this.client.projects.credentials.delete.mutate({
				projectId: args.id,
				envVarKey: flags.key,
			});

			if (flags.json) {
				this.outputJson({ ok: true });
				return;
			}

			this.log(`Deleted credential ${flags.key} from project ${args.id}`);
		} catch (err) {
			this.handleError(err);
		}
	}
}
