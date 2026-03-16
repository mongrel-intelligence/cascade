import { DashboardCommand } from '../_shared/base.js';

export default class ProjectsList extends DashboardCommand {
	static override description = 'List all projects.';

	static override flags = {
		...DashboardCommand.baseFlags,
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(ProjectsList);

		try {
			const projects = await this.client.projects.listFull.query();

			const columns = [
				{ key: 'id', header: 'ID' },
				{ key: 'name', header: 'Name' },
				{ key: 'repo', header: 'Repo' },
				{ key: 'baseBranch', header: 'Base Branch' },
				{ key: 'model', header: 'Model' },
				{ key: 'agentEngine', header: 'Engine' },
			];

			this.outputFormatted(
				projects as unknown as Record<string, unknown>[],
				columns,
				flags,
				projects,
				'No projects found. Create one with: cascade projects create --id <id> --name <name> --repo <owner/repo>',
			);
		} catch (err) {
			this.handleError(err);
		}
	}
}
