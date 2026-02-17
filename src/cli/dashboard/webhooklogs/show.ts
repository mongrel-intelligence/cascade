import { Args } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';
import { formatDate } from '../_shared/format.js';

export default class WebhookLogsShow extends DashboardCommand {
	static override description = 'Show full details of a webhook log entry.';

	static override args = {
		id: Args.string({ description: 'Webhook log ID (UUID)', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(WebhookLogsShow);

		try {
			const log = await this.client.webhookLogs.getById.query({ id: args.id });

			if (flags.json) {
				this.outputJson(log);
				return;
			}

			this.outputDetail(log as unknown as Record<string, unknown>, {
				id: { label: 'ID' },
				source: { label: 'Source' },
				method: { label: 'Method' },
				path: { label: 'Path' },
				eventType: { label: 'Event Type' },
				statusCode: { label: 'Status Code' },
				processed: { label: 'Processed', format: (v) => (v ? 'yes' : 'no') },
				projectId: { label: 'Project ID' },
				receivedAt: { label: 'Received At', format: formatDate },
			});

			// Print headers and body as formatted JSON
			if (log.headers) {
				console.log('\nHeaders:');
				console.log(JSON.stringify(log.headers, null, 2));
			}
			if (log.body) {
				console.log('\nBody:');
				console.log(JSON.stringify(log.body, null, 2));
			} else if (log.bodyRaw) {
				console.log('\nBody (raw):');
				console.log(log.bodyRaw);
			}
		} catch (err) {
			this.handleError(err);
		}
	}
}
