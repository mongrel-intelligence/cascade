import { Args } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';
import { formatBoolean } from '../_shared/format.js';

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
				cardBudgetUsd: { label: 'Card Budget' },
				agentBackend: { label: 'Backend' },
				subscriptionCostZero: { label: 'Sub Cost Zero', format: formatBoolean },
			});
		} catch (err) {
			this.handleError(err);
		}
	}
}
