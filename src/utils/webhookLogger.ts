import { insertWebhookLog, pruneWebhookLogs } from '../db/repositories/webhookLogsRepository.js';
import { logger } from './logging.js';

const DEFAULT_RETENTION_COUNT = 1000;
// Prune every N inserts to avoid running on every single insert
const PRUNE_EVERY_N = 100;
let insertCount = 0;

export interface WebhookLogInput {
	source: 'trello' | 'github' | 'jira';
	method: string;
	path: string;
	headers?: Record<string, string>;
	body?: unknown;
	bodyRaw?: string;
	statusCode?: number;
	projectId?: string;
	eventType?: string;
	processed?: boolean;
}

/**
 * Fire-and-forget webhook call logging.
 * Does NOT block the calling code — errors are logged but not thrown.
 */
export function logWebhookCall(input: WebhookLogInput): void {
	// Deliberately fire-and-forget — no await
	Promise.resolve()
		.then(async () => {
			await insertWebhookLog({
				source: input.source,
				method: input.method,
				path: input.path,
				headers: input.headers,
				body: input.body,
				bodyRaw: input.bodyRaw,
				statusCode: input.statusCode,
				projectId: input.projectId,
				eventType: input.eventType,
				processed: input.processed,
			});

			insertCount++;
			if (insertCount % PRUNE_EVERY_N === 0) {
				await pruneWebhookLogs(DEFAULT_RETENTION_COUNT);
			}
		})
		.catch((err) => {
			logger.debug('Failed to log webhook call', { error: String(err) });
		});
}

/**
 * Extract sanitized headers from a Headers-like object.
 * Skips sensitive auth headers.
 */
export function extractHeaders(
	headerFn: (name: string) => string | undefined | null,
	headerNames: string[],
): Record<string, string> {
	const result: Record<string, string> = {};
	for (const name of headerNames) {
		const value = headerFn(name);
		if (value) {
			result[name.toLowerCase()] = value;
		}
	}
	return result;
}
