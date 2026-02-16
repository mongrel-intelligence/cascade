import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class WebhooksCreate extends DashboardCommand {
	static override description = 'Create webhooks for a project.';

	static override args = {
		projectId: Args.string({ description: 'Project ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		'callback-url': Flags.string({ description: 'Callback base URL', required: true }),
		'trello-only': Flags.boolean({ description: 'Only create Trello webhook', default: false }),
		'github-only': Flags.boolean({ description: 'Only create GitHub webhook', default: false }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(WebhooksCreate);

		try {
			const result = await this.client.webhooks.create.mutate({
				projectId: args.projectId,
				callbackBaseUrl: flags['callback-url'],
				trelloOnly: flags['trello-only'],
				githubOnly: flags['github-only'],
			});

			if (flags.json) {
				this.outputJson(result);
				return;
			}

			if (result.trello) {
				if (typeof result.trello === 'string') {
					this.log(`Trello: ${result.trello}`);
				} else {
					this.log(`Created Trello webhook: [${result.trello.id}] ${result.trello.callbackURL}`);
				}
			}

			if (result.github) {
				if (typeof result.github === 'string') {
					this.log(`GitHub: ${result.github}`);
				} else {
					this.log(`Created GitHub webhook: [${result.github.id}] ${result.github.config.url}`);
				}
			}
		} catch (err) {
			this.handleError(err);
		}
	}
}
