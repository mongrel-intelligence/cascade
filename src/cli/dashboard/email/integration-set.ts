import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class EmailIntegrationSet extends DashboardCommand {
	static override description = 'Set email integration for a project.';

	static override args = {
		projectId: Args.string({ description: 'Project ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		provider: Flags.string({
			description: 'Email provider (gmail or imap)',
			required: true,
			options: ['gmail', 'imap'],
		}),
		config: Flags.string({
			description: 'Config as JSON string (optional)',
			default: '{}',
		}),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(EmailIntegrationSet);

		let config: Record<string, unknown>;
		try {
			config = JSON.parse(flags.config) as Record<string, unknown>;
		} catch {
			this.error('Invalid JSON in --config flag.');
		}

		try {
			await this.client.projects.integrations.upsert.mutate({
				projectId: args.projectId,
				category: 'email',
				provider: flags.provider,
				config,
			});

			if (flags.json) {
				this.outputJson({ ok: true });
				return;
			}

			this.log(`Set email/${flags.provider} integration for project: ${args.projectId}`);

			if (flags.provider === 'gmail') {
				this.log('Note: Run "cascade email oauth" to authenticate Gmail.');
			} else {
				this.log(
					'Note: Link IMAP credentials using "cascade projects integration-credential-set".',
				);
			}
		} catch (err) {
			this.handleError(err);
		}
	}
}
