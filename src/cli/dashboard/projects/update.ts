import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class ProjectsUpdate extends DashboardCommand {
	static override description = 'Update a project.';

	static override args = {
		id: Args.string({ description: 'Project ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		name: Flags.string({ description: 'Project name' }),
		repo: Flags.string({ description: 'GitHub repo (owner/name)' }),
		'base-branch': Flags.string({ description: 'Base branch' }),
		'branch-prefix': Flags.string({ description: 'Branch prefix' }),
		model: Flags.string({ description: 'Default model' }),
		'work-item-budget': Flags.string({ description: 'Per-work-item budget in USD' }),
		'agent-engine': Flags.string({ description: 'Agent engine' }),
		'run-links-enabled': Flags.boolean({
			description: 'Enable run links in agent comments (requires CASCADE_DASHBOARD_URL env var)',
			allowNo: true,
		}),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(ProjectsUpdate);

		try {
			await this.client.projects.update.mutate({
				id: args.id,
				name: flags.name,
				repo: flags.repo,
				baseBranch: flags['base-branch'],
				branchPrefix: flags['branch-prefix'],
				model: flags.model,
				workItemBudgetUsd: flags['work-item-budget'],
				agentEngine: flags['agent-engine'],
				...(flags['run-links-enabled'] !== undefined
					? { runLinksEnabled: flags['run-links-enabled'] }
					: {}),
			});

			if (flags.json) {
				this.outputJson({ ok: true });
				return;
			}

			this.log(`Updated project: ${args.id}`);
		} catch (err) {
			this.handleError(err);
		}
	}
}
