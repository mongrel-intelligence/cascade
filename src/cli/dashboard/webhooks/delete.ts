import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class WebhooksDelete extends DashboardCommand {
	static override description = 'Delete webhooks for a project.';

	static override args = {
		projectId: Args.string({ description: 'Project ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		'callback-url': Flags.string({ description: 'Callback base URL', required: true }),
		'trello-only': Flags.boolean({ description: 'Only delete Trello webhooks', default: false }),
		'github-only': Flags.boolean({ description: 'Only delete GitHub webhooks', default: false }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(WebhooksDelete);

		try {
			const result = await this.client.webhooks.delete.mutate({
				projectId: args.projectId,
				callbackBaseUrl: flags['callback-url'],
				trelloOnly: flags['trello-only'],
				githubOnly: flags['github-only'],
			});

			if (flags.json) {
				this.outputJson(result);
				return;
			}

			if (result.trello.length > 0) {
				this.log(`Deleted ${result.trello.length} Trello webhook(s): ${result.trello.join(', ')}`);
			} else {
				this.log('No matching Trello webhooks found.');
			}

			if (result.github.length > 0) {
				this.log(`Deleted ${result.github.length} GitHub webhook(s): ${result.github.join(', ')}`);
			} else {
				this.log('No matching GitHub webhooks found.');
			}
		} catch (err) {
			this.handleError(err);
		}
	}
}
