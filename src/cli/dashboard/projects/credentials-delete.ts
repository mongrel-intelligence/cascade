import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';
import { confirm } from '../_shared/confirm.js';

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

		await confirm(`Delete credential ${flags.key} from project ${args.id}?`, flags.yes);

		try {
			await this.withSpinner('Deleting credential...', () =>
				this.client.projects.credentials.delete.mutate({
					projectId: args.id,
					envVarKey: flags.key,
				}),
			);

			if (flags.json) {
				this.outputJson({ ok: true });
				return;
			}

			this.success(`Deleted credential ${flags.key} from project '${args.id}'`);
		} catch (err) {
			this.handleError(err);
		}
	}
}
