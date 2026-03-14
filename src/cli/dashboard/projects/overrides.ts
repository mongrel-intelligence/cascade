import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class ProjectsIntegrationCredentials extends DashboardCommand {
	static override description = 'Show integration credentials for a project.';

	static override aliases = ['projects:integration-credentials'];

	static override args = {
		id: Args.string({ description: 'Project ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		category: Flags.string({
			description: 'Filter by integration category (pm or scm)',
			options: ['pm', 'scm'],
		}),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(ProjectsIntegrationCredentials);

		try {
			const categories = flags.category
				? [flags.category as 'pm' | 'scm']
				: (['pm', 'scm'] as const);

			const allCreds: Array<Record<string, unknown>> = [];

			for (const category of categories) {
				const creds = await this.client.projects.integrationCredentials.list.query({
					projectId: args.id,
					category,
				});
				for (const c of creds as unknown as Array<Record<string, unknown>>) {
					allCreds.push({ ...c, category });
				}
			}

			if (flags.json) {
				this.outputJson(allCreds);
				return;
			}

			if (allCreds.length === 0) {
				this.log('No integration credentials configured.');
				return;
			}

			this.outputTable(allCreds, [
				{ key: 'category', header: 'Category' },
				{ key: 'role', header: 'Role' },
				{ key: 'credentialId', header: 'Credential ID' },
				{ key: 'credentialName', header: 'Credential Name' },
			]);
		} catch (err) {
			this.handleError(err);
		}
	}
}
