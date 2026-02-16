import { Args } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class WebhooksList extends DashboardCommand {
	static override description = 'List Trello and GitHub webhooks for a project.';

	static override args = {
		projectId: Args.string({ description: 'Project ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(WebhooksList);

		try {
			const result = await this.client.webhooks.list.query({ projectId: args.projectId });

			if (flags.json) {
				this.outputJson(result);
				return;
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
		} catch (err) {
			this.handleError(err);
		}
	}
}
