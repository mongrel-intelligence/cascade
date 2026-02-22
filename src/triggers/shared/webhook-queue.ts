import { dequeueWebhook, getQueueLength } from '../../utils/index.js';
import { logger } from '../../utils/logging.js';

/**
 * Dequeue and process the next queued webhook if one is waiting.
 *
 * @param processWebhook - Function to call with the next queued payload.
 * @param label - Log label for the source (e.g. 'Trello', 'GitHub', 'JIRA').
 * @param getEventType - Optional function to extract event type from the queued entry.
 */
export function processNextQueuedWebhook(
	processWebhook: (
		payload: unknown,
		eventType?: string,
		ackCommentId?: string | number,
	) => Promise<void>,
	label: string,
	getEventType?: (entry: { payload: unknown; eventType?: string }) => string | undefined,
): void {
	const next = dequeueWebhook();
	if (next) {
		const eventType = getEventType ? getEventType(next) : undefined;
		const logContext: Record<string, unknown> = { queueLength: getQueueLength() };
		if (eventType) logContext.eventType = eventType;
		logger.info(`Processing queued ${label} webhook`, logContext);
		setImmediate(() => {
			processWebhook(next.payload, eventType, next.ackCommentId).catch((err) => {
				logger.error(`Failed to process queued ${label} webhook`, { error: String(err) });
			});
		});
	}
}
