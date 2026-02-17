import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class ProjectsOverrideSet extends DashboardCommand {
	static override description = 'Set a credential override for a project.';

	static override args = {
		id: Args.string({ description: 'Project ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		key: Flags.string({
			description: 'Environment variable key (e.g. GITHUB_TOKEN_IMPLEMENTER)',
			required: true,
		}),
		'credential-id': Flags.integer({ description: 'Credential ID to use', required: true }),
		'agent-type': Flags.string({ description: 'Scope to specific agent type' }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(ProjectsOverrideSet);

		try {
			if (flags['agent-type']) {
				await this.client.projects.credentialOverrides.setAgent.mutate({
					projectId: args.id,
					envVarKey: flags.key,
					agentType: flags['agent-type'],
					credentialId: flags['credential-id'],
				});
			} else {
				await this.client.projects.credentialOverrides.set.mutate({
					projectId: args.id,
					envVarKey: flags.key,
					credentialId: flags['credential-id'],
				});
			}

			if (flags.json) {
				this.outputJson({ ok: true });
				return;
			}

			const scope = flags['agent-type'] ? ` (agent: ${flags['agent-type']})` : '';
			this.log(`Set override ${flags.key} → credential #${flags['credential-id']}${scope}`);
		} catch (err) {
			this.handleError(err);
		}
	}
}
