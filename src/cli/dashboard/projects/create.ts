import { Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class ProjectsCreate extends DashboardCommand {
	static override description = 'Create a new project.';

	static override flags = {
		...DashboardCommand.baseFlags,
		id: Flags.string({ description: 'Project ID (lowercase, hyphens)', required: true }),
		name: Flags.string({ description: 'Project name', required: true }),
		repo: Flags.string({ description: 'GitHub repo (owner/name)', required: true }),
		'base-branch': Flags.string({ description: 'Base branch (default: main)' }),
		'branch-prefix': Flags.string({ description: 'Branch prefix' }),
		model: Flags.string({ description: 'Default model' }),
		'work-item-budget': Flags.string({ description: 'Per-work-item budget in USD' }),
		'agent-engine': Flags.string({ description: 'Agent engine (e.g. claude-code)' }),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(ProjectsCreate);

		try {
			const result = await this.client.projects.create.mutate({
				id: flags.id,
				name: flags.name,
				repo: flags.repo,
				baseBranch: flags['base-branch'],
				branchPrefix: flags['branch-prefix'],
				model: flags.model,
				workItemBudgetUsd: flags['work-item-budget'],
				agentEngine: flags['agent-engine'],
			});

			if (flags.json) {
				this.outputJson(result);
				return;
			}

			this.log(`Created project: ${flags.id}`);
		} catch (err) {
			this.handleError(err);
		}
	}
}
