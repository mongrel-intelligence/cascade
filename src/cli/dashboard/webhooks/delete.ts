import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class WebhooksDelete extends DashboardCommand {
	static override description = 'Delete webhooks for a project.';

	static override args = {
		projectId: Args.string({ description: 'Project ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		'callback-url': Flags.string({
			description: 'Callback base URL (defaults to server URL)',
		}),
		'trello-only': Flags.boolean({ description: 'Only delete Trello webhooks', default: false }),
		'github-only': Flags.boolean({ description: 'Only delete GitHub webhooks', default: false }),
		'github-token': Flags.string({
			description: 'One-time GitHub PAT with admin:repo_hook scope',
		}),
		'trello-api-key': Flags.string({ description: 'One-time Trello API key' }),
		'trello-token': Flags.string({ description: 'One-time Trello token' }),
		'jira-email': Flags.string({ description: 'One-time JIRA email' }),
		'jira-api-token': Flags.string({ description: 'One-time JIRA API token' }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(WebhooksDelete);

		try {
			const callbackBaseUrl = flags['callback-url'] || this.config_.serverUrl;

			const oneTimeTokens: Record<string, string> = {};
			if (flags['github-token']) oneTimeTokens.github = flags['github-token'];
			if (flags['trello-api-key']) oneTimeTokens.trelloApiKey = flags['trello-api-key'];
			if (flags['trello-token']) oneTimeTokens.trelloToken = flags['trello-token'];
			if (flags['jira-email']) oneTimeTokens.jiraEmail = flags['jira-email'];
			if (flags['jira-api-token']) oneTimeTokens.jiraApiToken = flags['jira-api-token'];

			const result = await this.withSpinner('Deleting webhooks...', () =>
				this.client.webhooks.delete.mutate({
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

			if (result.trello.length > 0) {
				this.success(
					`Deleted ${result.trello.length} Trello webhook(s): ${result.trello.join(', ')}`,
				);
			} else {
				this.log('No matching Trello webhooks found.');
			}

			if (result.github.length > 0) {
				this.success(
					`Deleted ${result.github.length} GitHub webhook(s): ${result.github.join(', ')}`,
				);
			} else {
				this.log('No matching GitHub webhooks found.');
			}

			if (result.jira.length > 0) {
				this.success(`Deleted ${result.jira.length} JIRA webhook(s): ${result.jira.join(', ')}`);
			} else {
				this.log('No matching JIRA webhooks found.');
			}
		} catch (err) {
			this.handleError(err);
		}
	}
}
