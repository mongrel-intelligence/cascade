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
			const [project, enginesInUse] = await Promise.all([
				this.client.projects.getById.query({ id: args.id }),
				this.client.agentConfigs.enginesInUse.query({ projectId: args.id }).catch(() => []),
			]);

			if (flags.json) {
				this.outputJson({ ...project, enginesInUse });
				return;
			}

			const projectWithEngines = {
				...(project as unknown as Record<string, unknown>),
				enginesInUse: enginesInUse.length > 0 ? enginesInUse.join(', ') : null,
			};

			this.outputDetail(projectWithEngines, {
				id: { label: 'ID' },
				name: { label: 'Name' },
				repo: { label: 'Repo' },
				baseBranch: { label: 'Base Branch' },
				branchPrefix: { label: 'Branch Prefix' },
				model: { label: 'Model' },
				workItemBudgetUsd: { label: 'Work Item Budget' },
				agentEngine: { label: 'Engine' },
				maxInFlightItems: { label: 'Max In-Flight Items' },
				enginesInUse: { label: 'Agent Engines In Use' },
			});
		} catch (err) {
			this.handleError(err);
		}
	}
}
