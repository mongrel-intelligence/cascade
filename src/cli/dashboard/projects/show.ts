import { Args } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class ProjectsShow extends DashboardCommand {
	static override description = 'Show project details.';

	static override args = {
		id: Args.string({ description: 'Project ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(ProjectsShow);

		try {
			const project = await this.client.projects.getById.query({ id: args.id });

			if (flags.json) {
				this.outputJson(project);
				return;
			}

			this.outputDetail(project as unknown as Record<string, unknown>, {
				id: { label: 'ID' },
				name: { label: 'Name' },
				repo: { label: 'Repo' },
				baseBranch: { label: 'Base Branch' },
				branchPrefix: { label: 'Branch Prefix' },
				model: { label: 'Model' },
				workItemBudgetUsd: { label: 'Work Item Budget' },
				agentEngine: { label: 'Engine' },
				maxInFlightItems: { label: 'Max In-Flight Items' },
			});
		} catch (err) {
			this.handleError(err);
		}
	}
}
