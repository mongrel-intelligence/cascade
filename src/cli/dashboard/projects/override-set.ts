import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class ProjectsIntegrationCredentialSet extends DashboardCommand {
	static override description = 'Link a credential to an integration role for a project.';

	static override aliases = ['projects:integration-credential-set'];

	static override args = {
		id: Args.string({ description: 'Project ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		category: Flags.string({
			description: 'Integration category (pm, scm, email, or sms)',
			required: true,
			options: ['pm', 'scm', 'email', 'sms'],
		}),
		role: Flags.string({
			description: 'Credential role (e.g. api_key, token, implementer_token)',
			required: true,
		}),
		'credential-id': Flags.integer({ description: 'Credential ID to link', required: true }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(ProjectsIntegrationCredentialSet);

		try {
			await this.client.projects.integrationCredentials.set.mutate({
				projectId: args.id,
				category: flags.category as 'pm' | 'scm' | 'email' | 'sms',
				role: flags.role,
				credentialId: flags['credential-id'],
			});

			if (flags.json) {
				this.outputJson({ ok: true });
				return;
			}

			this.log(`Set ${flags.category}/${flags.role} → credential #${flags['credential-id']}`);
		} catch (err) {
			this.handleError(err);
		}
	}
}
