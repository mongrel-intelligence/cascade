import { insertWebhookLog, pruneWebhookLogs } from '../db/repositories/webhookLogsRepository.js';
import { logger } from './logging.js';

const DEFAULT_RETENTION = 1000;
// Prune every ~100 inserts to amortize cost
const PRUNE_EVERY = 100;

let insertCount = 0;

export interface WebhookLogCallInput {
	source: string;
	method: string;
	path: string;
	headers?: Record<string, string | string[] | undefined>;
	body?: unknown;
	bodyRaw?: string;
	statusCode?: number;
	projectId?: string;
	eventType?: string;
	processed?: boolean;
}

/**
 * Log a webhook call. Fire-and-forget — never throws, never awaited on critical path.
 */
export function logWebhookCall(input: WebhookLogCallInput): void {
	// Convert headers to plain object (handles Header instances etc.)
	const headers: Record<string, unknown> | undefined = input.headers
		? Object.fromEntries(Object.entries(input.headers).filter(([, v]) => v !== undefined))
		: undefined;

	setImmediate(async () => {
		try {
			await insertWebhookLog({
				source: input.source,
				method: input.method,
				path: input.path,
				headers,
				body: input.body,
				bodyRaw: input.bodyRaw,
				statusCode: input.statusCode,
				projectId: input.projectId,
				eventType: input.eventType,
				processed: input.processed ?? false,
			});

			insertCount++;
			if (insertCount % PRUNE_EVERY === 0) {
				await pruneWebhookLogs(DEFAULT_RETENTION);
			}
		} catch (err) {
			logger.debug('Failed to log webhook call', { error: String(err) });
		}
	});
}
