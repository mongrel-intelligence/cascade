import { Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';
import { formatDate } from '../_shared/format.js';

export default class WebhookLogsList extends DashboardCommand {
	static override description = 'List recent webhook calls.';

	static override flags = {
		...DashboardCommand.baseFlags,
		source: Flags.string({ description: 'Filter by source (trello, github, jira)' }),
		'event-type': Flags.string({ description: 'Filter by event type' }),
		limit: Flags.integer({ description: 'Number of results', default: 50 }),
		offset: Flags.integer({ description: 'Offset for pagination', default: 0 }),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(WebhookLogsList);

		try {
			const result = await this.client.webhookLogs.list.query({
				source: flags.source,
				eventType: flags['event-type'],
				limit: flags.limit,
				offset: flags.offset,
			});

			const columns = [
				{ key: 'id', header: 'ID', format: (v: unknown) => String(v ?? '').slice(0, 8) },
				{ key: 'source', header: 'Source' },
				{ key: 'eventType', header: 'Event' },
				{ key: 'statusCode', header: 'Status' },
				{ key: 'processed', header: 'Processed', format: (v: unknown) => (v ? 'yes' : 'no') },
				{
					key: 'decisionReason',
					header: 'Reason',
					format: (v: unknown) => (v ? String(v).slice(0, 50) : '-'),
				},
				{ key: 'receivedAt', header: 'Time', format: formatDate },
			];

			this.outputFormatted(
				result.data as unknown as Record<string, unknown>[],
				columns,
				flags,
				result,
				'No webhook logs found. Webhook logs appear when CASCADE receives events from Trello, GitHub, or JIRA.',
			);
		} catch (err) {
			this.handleError(err);
		}
	}
}
