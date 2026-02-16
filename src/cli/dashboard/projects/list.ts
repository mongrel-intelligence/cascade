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

			if (flags.json) {
				this.outputJson(projects);
				return;
			}

			this.outputTable(projects as unknown as Record<string, unknown>[], [
				{ key: 'id', header: 'ID' },
				{ key: 'name', header: 'Name' },
				{ key: 'repo', header: 'Repo' },
				{ key: 'baseBranch', header: 'Base Branch' },
				{ key: 'model', header: 'Model' },
				{ key: 'agentBackend', header: 'Backend' },
			]);
		} catch (err) {
			this.handleError(err);
		}
	}
}
