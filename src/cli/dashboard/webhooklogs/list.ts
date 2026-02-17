import { Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';
import { formatDate } from '../_shared/format.js';

export default class WebhooklogsList extends DashboardCommand {
	static override description = 'List webhook call logs.';

	static override flags = {
		...DashboardCommand.baseFlags,
		source: Flags.string({ description: 'Filter by source (trello, github, jira)' }),
		'event-type': Flags.string({ description: 'Filter by event type' }),
		limit: Flags.integer({ description: 'Number of results', default: 50 }),
		offset: Flags.integer({ description: 'Offset for pagination', default: 0 }),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(WebhooklogsList);

		try {
			const result = await this.client.webhookLogs.list.query({
				source: flags.source,
				eventType: flags['event-type'],
				limit: flags.limit,
				offset: flags.offset,
			});

			if (flags.json) {
				this.outputJson(result);
				return;
			}

			this.outputTable(result.data as unknown as Record<string, unknown>[], [
				{ key: 'id', header: 'ID', format: (v) => String(v ?? '').slice(0, 8) },
				{ key: 'source', header: 'Source' },
				{ key: 'eventType', header: 'Event' },
				{ key: 'statusCode', header: 'Status' },
				{
					key: 'processed',
					header: 'Processed',
					format: (v) => (v ? 'yes' : 'no'),
				},
				{ key: 'receivedAt', header: 'Time', format: formatDate },
			]);

			if (!flags.json) {
				this.log(`\nTotal: ${result.total}`);
			}
		} catch (err) {
			this.handleError(err);
		}
	}
}
