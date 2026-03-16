import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class WebhooksCreate extends DashboardCommand {
	static override description = 'Create webhooks for a project.';

	static override args = {
		projectId: Args.string({ description: 'Project ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		'callback-url': Flags.string({
			description: 'Callback base URL (defaults to server URL)',
		}),
		'trello-only': Flags.boolean({ description: 'Only create Trello webhook', default: false }),
		'github-only': Flags.boolean({ description: 'Only create GitHub webhook', default: false }),
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
		const { args, flags } = await this.parse(WebhooksCreate);

		try {
			const callbackBaseUrl = flags['callback-url'] || this.config_.serverUrl;

			const oneTimeTokens: Record<string, string> = {};
			if (flags['github-token']) oneTimeTokens.github = flags['github-token'];
			if (flags['trello-api-key']) oneTimeTokens.trelloApiKey = flags['trello-api-key'];
			if (flags['trello-token']) oneTimeTokens.trelloToken = flags['trello-token'];
			if (flags['jira-email']) oneTimeTokens.jiraEmail = flags['jira-email'];
			if (flags['jira-api-token']) oneTimeTokens.jiraApiToken = flags['jira-api-token'];

			const result = await this.withSpinner('Creating webhooks...', () =>
				this.client.webhooks.create.mutate({
					projectId: args.projectId,
					callbackBaseUrl,
					trelloOnly: flags['trello-only'],
					githubOnly: flags['github-only'],
					oneTimeTokens: Object.keys(oneTimeTokens).length > 0 ? oneTimeTokens : undefined,
				}),
			);

			if (flags.json) {
				this.outputJson(result);
				return;
			}

			if (result.trello) {
				if (typeof result.trello === 'string') {
					this.log(`Trello: ${result.trello}`);
				} else {
					this.success(
						`Created Trello webhook: [${result.trello.id}] ${result.trello.callbackURL}`,
					);
				}
			}

			if (result.github) {
				if (typeof result.github === 'string') {
					this.log(`GitHub: ${result.github}`);
				} else {
					this.success(`Created GitHub webhook: [${result.github.id}] ${result.github.config.url}`);
				}
			}

			if (result.jira) {
				if (typeof result.jira === 'string') {
					this.log(`JIRA: ${result.jira}`);
				} else {
					this.success(`Created JIRA webhook: [${result.jira.id}] ${result.jira.url}`);
				}
			}
		} catch (err) {
			this.handleError(err);
		}
	}
}
