import { Args, Flags } from '@oclif/core';
import { z } from 'zod';
import { DashboardCommand } from '../_shared/base.js';

type EmailIntegration = { category: string; triggers: unknown };
type EmailTriggers = { senderEmail?: string | null };

function extractSenderEmail(integration: EmailIntegration | undefined): string | null {
	if (!integration?.triggers) return null;
	return (integration.triggers as EmailTriggers).senderEmail ?? null;
}

export default class EmailJokeConfig extends DashboardCommand {
	static override description = 'Configure email-joke agent sender filter.';

	static override args = {
		projectId: Args.string({ description: 'Project ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		'sender-email': Flags.string({
			description: 'Email address to filter (only respond to emails from this sender)',
			required: false,
		}),
		clear: Flags.boolean({
			description: 'Clear the sender email filter',
			default: false,
		}),
	};

	static override examples = [
		'<%= config.bin %> <%= command.id %> my-project --sender-email friend@example.com',
		'<%= config.bin %> <%= command.id %> my-project --clear',
	];

	private displayCurrentConfig(
		emailIntegration: EmailIntegration | undefined,
		useJson: boolean,
	): void {
		const senderEmail = extractSenderEmail(emailIntegration);

		if (useJson) {
			this.outputJson({ senderEmail });
			return;
		}

		if (senderEmail) {
			this.log(`Current sender filter: ${senderEmail}`);
		} else if (emailIntegration) {
			this.log('Current sender filter: (none)');
		} else {
			this.log('No email integration configured for this project.');
		}
	}

	async run(): Promise<void> {
		const { args, flags } = await this.parse(EmailJokeConfig);

		try {
			// Validate email address format if provided
			if (flags['sender-email']) {
				const result = z.string().email().safeParse(flags['sender-email']);
				if (!result.success) {
					this.error('Invalid email address format');
				}
			}

			// Build triggers update
			const triggers: Record<string, string | null> = {};
			if (flags['sender-email']) {
				triggers.senderEmail = flags['sender-email'];
			} else if (flags.clear) {
				triggers.senderEmail = null;
			}

			// Fetch integrations to check if email integration exists
			const integrations = await this.client.projects.integrations.list.query({
				projectId: args.projectId,
			});

			const emailIntegration = (integrations as unknown as EmailIntegration[]).find(
				(i) => i.category === 'email',
			);

			// No update requested, just show current config
			if (Object.keys(triggers).length === 0) {
				this.displayCurrentConfig(emailIntegration, flags.json);
				return;
			}

			// Check if email integration exists before attempting update
			if (!emailIntegration) {
				this.error(
					'No email integration configured for this project. Configure email integration first.',
				);
			}

			await this.client.projects.integrations.updateTriggers.mutate({
				projectId: args.projectId,
				category: 'email',
				triggers,
			});

			if (flags.json) {
				this.outputJson({ success: true, triggers });
			} else if (triggers.senderEmail) {
				this.log(`Sender filter set to: ${triggers.senderEmail}`);
			} else {
				this.log('Sender filter cleared.');
			}
		} catch (err) {
			this.handleError(err);
		}
	}
}
