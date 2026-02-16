import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class ProjectsOverrideRm extends DashboardCommand {
	static override description = 'Remove a credential override from a project.';

	static override args = {
		id: Args.string({ description: 'Project ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		key: Flags.string({ description: 'Environment variable key', required: true }),
		'agent-type': Flags.string({ description: 'Remove agent-scoped override' }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(ProjectsOverrideRm);

		try {
			if (flags['agent-type']) {
				await this.client.projects.credentialOverrides.removeAgent.mutate({
					projectId: args.id,
					envVarKey: flags.key,
					agentType: flags['agent-type'],
				});
			} else {
				await this.client.projects.credentialOverrides.remove.mutate({
					projectId: args.id,
					envVarKey: flags.key,
				});
			}

			if (flags.json) {
				this.outputJson({ ok: true });
				return;
			}

			const scope = flags['agent-type'] ? ` (agent: ${flags['agent-type']})` : '';
			this.log(`Removed override ${flags.key}${scope}`);
		} catch (err) {
			this.handleError(err);
		}
	}
}
