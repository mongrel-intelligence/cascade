import { insertWebhookLog, pruneWebhookLogs } from '../db/repositories/webhookLogsRepository.js';
import { logger } from './logging.js';

const DEFAULT_RETENTION = 1000;
const PRUNE_EVERY_N_INSERTS = 100;

let insertCount = 0;

export interface WebhookLogInput {
	source: 'trello' | 'github' | 'jira';
	method: string;
	path: string;
	headers?: Record<string, string>;
	body?: unknown;
	bodyRaw?: string;
	statusCode: number;
	projectId?: string;
	eventType?: string;
	processed: boolean;
}

/**
 * Log a webhook call to the database. Fire-and-forget — never throws.
 */
export function logWebhookCall(input: WebhookLogInput): void {
	setImmediate(() => {
		_logWebhookCallAsync(input).catch((err) => {
			logger.debug('Failed to log webhook call', { error: String(err) });
		});
	});
}

async function _logWebhookCallAsync(input: WebhookLogInput): Promise<void> {
	await insertWebhookLog({
		source: input.source,
		method: input.method,
		path: input.path,
		headers: input.headers as Record<string, unknown> | undefined,
		body: input.body as Record<string, unknown> | undefined,
		bodyRaw: input.bodyRaw,
		statusCode: input.statusCode,
		projectId: input.projectId,
		eventType: input.eventType,
		processed: input.processed,
	});

	insertCount += 1;
	if (insertCount % PRUNE_EVERY_N_INSERTS === 0) {
		await pruneWebhookLogs(DEFAULT_RETENTION);
	}
}
