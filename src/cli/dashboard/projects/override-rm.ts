import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class ProjectsIntegrationCredentialRm extends DashboardCommand {
	static override description = 'Unlink a credential from an integration role for a project.';

	static override aliases = ['projects:integration-credential-rm'];

	static override args = {
		id: Args.string({ description: 'Project ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		category: Flags.string({
			description: 'Integration category (pm or scm)',
			required: true,
			options: ['pm', 'scm'],
		}),
		role: Flags.string({
			description: 'Credential role to unlink (e.g. api_key, token, implementer_token)',
			required: true,
		}),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(ProjectsIntegrationCredentialRm);

		try {
			await this.client.projects.integrationCredentials.remove.mutate({
				projectId: args.id,
				category: flags.category as 'pm' | 'scm',
				role: flags.role,
			});

			if (flags.json) {
				this.outputJson({ ok: true });
				return;
			}

			this.log(`Removed ${flags.category}/${flags.role} credential link`);
		} catch (err) {
			this.handleError(err);
		}
	}
}
