import { Args } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class ProjectsCredentialsList extends DashboardCommand {
	static override description = 'List project-scoped credentials (values masked).';

	static override args = {
		id: Args.string({ description: 'Project ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(ProjectsCredentialsList);

		try {
			const creds = await this.client.projects.credentials.list.query({
				projectId: args.id,
			});

			if (flags.json) {
				this.outputJson(creds);
				return;
			}

			if (creds.length === 0) {
				this.log('No project credentials configured.');
				return;
			}

			this.outputTable(creds as unknown as Record<string, unknown>[], [
				{ key: 'envVarKey', header: 'Key' },
				{ key: 'name', header: 'Name' },
				{ key: 'maskedValue', header: 'Value (masked)' },
			]);
		} catch (err) {
			this.handleError(err);
		}
	}
}
