import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class ProjectsCredentialsSet extends DashboardCommand {
	static override description = 'Set a project-scoped credential (upsert by env var key).';

	static override args = {
		id: Args.string({ description: 'Project ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		key: Flags.string({
			description: 'Environment variable key (e.g. GITHUB_TOKEN_IMPLEMENTER)',
			required: true,
		}),
		value: Flags.string({ description: 'Credential value', required: true }),
		name: Flags.string({ description: 'Human-readable name for the credential' }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(ProjectsCredentialsSet);

		try {
			await this.withSpinner('Setting credential...', () =>
				this.client.projects.credentials.set.mutate({
					projectId: args.id,
					envVarKey: flags.key,
					value: flags.value,
					name: flags.name,
				}),
			);

			if (flags.json) {
				this.outputJson({ ok: true });
				return;
			}

			this.success(`Set credential ${flags.key} for project '${args.id}'`);
		} catch (err) {
			this.handleError(err);
		}
	}
}
