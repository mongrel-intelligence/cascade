import { Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class RunsTrigger extends DashboardCommand {
	static override description = 'Manually trigger an agent run.';

	static override flags = {
		...DashboardCommand.baseFlags,
		project: Flags.string({ description: 'Project ID', required: true }),
		'agent-type': Flags.string({ description: 'Agent type to run', required: true }),
		'card-id': Flags.string({ description: 'Card ID (optional)' }),
		'pr-number': Flags.integer({ description: 'PR number (optional)' }),
		'pr-branch': Flags.string({ description: 'PR branch (optional)' }),
		'repo-full-name': Flags.string({ description: 'Repository full name (optional)' }),
		'head-sha': Flags.string({ description: 'Git SHA (optional)' }),
		model: Flags.string({ description: 'Override model (optional)' }),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(RunsTrigger);

		try {
			const result = await this.client.runs.trigger.mutate({
				projectId: flags.project,
				agentType: flags['agent-type'],
				workItemId: flags['card-id'],
				prNumber: flags['pr-number'],
				prBranch: flags['pr-branch'],
				repoFullName: flags['repo-full-name'],
				headSha: flags['head-sha'],
				model: flags.model,
			});

			if (flags.json) {
				this.outputJson(result);
			} else {
				this.log('Agent run triggered successfully.');
			}
		} catch (err) {
			this.handleError(err);
		}
	}
}
