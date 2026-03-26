import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class WebhooksList extends DashboardCommand {
	static override description = 'List Trello, GitHub, and JIRA webhooks for a project.';

	static override args = {
		projectId: Args.string({ description: 'Project ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		'github-token': Flags.string({
			description: 'One-time GitHub PAT with admin:repo_hook scope',
		}),
		'trello-api-key': Flags.string({ description: 'One-time Trello API key' }),
		'trello-token': Flags.string({ description: 'One-time Trello token' }),
		'jira-email': Flags.string({ description: 'One-time JIRA email' }),
		'jira-api-token': Flags.string({ description: 'One-time JIRA API token' }),
	};

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: multi-provider output formatting
	async run(): Promise<void> {
		const { args, flags } = await this.parse(WebhooksList);

		try {
			const oneTimeTokens: Record<string, string> = {};
			if (flags['github-token']) oneTimeTokens.github = flags['github-token'];
			if (flags['trello-api-key']) oneTimeTokens.trelloApiKey = flags['trello-api-key'];
			if (flags['trello-token']) oneTimeTokens.trelloToken = flags['trello-token'];
			if (flags['jira-email']) oneTimeTokens.jiraEmail = flags['jira-email'];
			if (flags['jira-api-token']) oneTimeTokens.jiraApiToken = flags['jira-api-token'];

			const result = await this.client.webhooks.list.query({
				projectId: args.projectId,
				callbackBaseUrl: this.config_.serverUrl || undefined,
				oneTimeTokens: Object.keys(oneTimeTokens).length > 0 ? oneTimeTokens : undefined,
			});

			if (flags.json) {
				this.outputJson(result);
				return;
			}

			// Per-provider errors
			if (result.errors) {
				for (const [provider, err] of Object.entries(result.errors)) {
					if (err) {
						this.warn(`${provider}: ${err}`);
					}
				}
			}

			this.log('Trello webhooks:');
			if (result.trello.length === 0) {
				this.log('  (none)');
			} else {
				for (const w of result.trello) {
					this.log(`  [${w.id}] ${w.callbackURL} (active: ${w.active})`);
					if (w.description) this.log(`    ${w.description}`);
				}
			}

			this.log('');
			this.log('GitHub webhooks:');
			if (result.github.length === 0) {
				this.log('  (none)');
			} else {
				for (const w of result.github) {
					this.log(
						`  [${w.id}] ${w.config.url} (active: ${w.active}, events: ${w.events.join(', ')})`,
					);
				}
			}

			this.log('');
			this.log('JIRA webhooks:');
			if (result.jira.length === 0) {
				this.log('  (none)');
			} else {
				for (const w of result.jira) {
					this.log(`  [${w.id}] ${w.url} (active: ${w.enabled})`);
				}
			}

			this.log('');
			this.log('Sentry webhook:');
			if (result.sentry) {
				this.log(`  URL: ${result.sentry.url}`);
				this.log(`  Webhook secret: ${result.sentry.webhookSecretSet ? 'configured' : 'not set'}`);
				this.log(`  ${result.sentry.note}`);
			} else {
				this.log('  (not configured)');
			}
		} catch (err) {
			this.handleError(err);
		}
	}
}
