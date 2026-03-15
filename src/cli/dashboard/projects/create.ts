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
		'max-iterations': Flags.integer({ description: 'Max iterations per agent run' }),
		'watchdog-timeout': Flags.integer({ description: 'Watchdog timeout (ms)' }),
		'work-item-budget': Flags.string({ description: 'Per-work-item budget in USD' }),
		'agent-engine': Flags.string({ description: 'Agent engine (e.g. claude-code)' }),
		'progress-model': Flags.string({ description: 'Model for progress updates' }),
		'progress-interval': Flags.string({ description: 'Progress update interval (minutes)' }),
		'max-in-flight-items': Flags.integer({
			description: 'Max in-flight items (pipeline throughput)',
		}),
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
				maxIterations: flags['max-iterations'],
				watchdogTimeoutMs: flags['watchdog-timeout'],
				workItemBudgetUsd: flags['work-item-budget'],
				agentEngine: flags['agent-engine'],
				progressModel: flags['progress-model'],
				progressIntervalMinutes: flags['progress-interval'],
				maxInFlightItems: flags['max-in-flight-items'],
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
