import { logger } from './logging.js';

const MAX_QUEUE_SIZE = 10;

interface QueuedWebhook {
	payload: unknown;
	eventType?: string; // Optional for backward compatibility (Trello doesn't need it)
	ackCommentId?: string | number;
	ackMessage?: string;
	receivedAt: Date;
}

const queue: QueuedWebhook[] = [];

export function enqueueWebhook(
	payload: unknown,
	eventType?: string,
	ackCommentId?: string | number,
	ackMessage?: string,
): boolean {
	if (queue.length >= MAX_QUEUE_SIZE) {
		logger.warn('Webhook queue full, rejecting', {
			queueLength: queue.length,
			maxSize: MAX_QUEUE_SIZE,
		});
		return false;
	}

	queue.push({
		payload,
		eventType,
		ackCommentId,
		ackMessage,
		receivedAt: new Date(),
	});

	logger.debug('Webhook enqueued', { queueLength: queue.length });
	return true;
}

export function dequeueWebhook(): QueuedWebhook | undefined {
	const item = queue.shift();
	if (item) {
		logger.debug('Webhook dequeued', {
			queueLength: queue.length,
			ageMs: Date.now() - item.receivedAt.getTime(),
		});
	}
	return item;
}

export function getQueueLength(): number {
	return queue.length;
}

export function clearQueue(): void {
	const length = queue.length;
	queue.length = 0;
	if (length > 0) {
		logger.debug('Queue cleared', { itemsCleared: length });
	}
}

export function getMaxQueueSize(): number {
	return MAX_QUEUE_SIZE;
}

export function canAcceptWebhook(): boolean {
	return queue.length < MAX_QUEUE_SIZE;
}
