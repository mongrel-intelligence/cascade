import { afterEach, describe, expect, it, vi } from 'vitest';
import { processNextQueuedWebhook } from '../../../src/triggers/shared/webhook-queue.js';
import { clearQueue, enqueueWebhook } from '../../../src/utils/webhookQueue.js';

describe('processNextQueuedWebhook', () => {
	afterEach(() => {
		clearQueue();
	});

	it('does nothing when queue is empty', () => {
		const processWebhook = vi.fn().mockResolvedValue(undefined);

		processNextQueuedWebhook(processWebhook, 'Test');

		expect(processWebhook).not.toHaveBeenCalled();
	});

	it('forwards payload and eventType to processWebhook', async () => {
		const processWebhook = vi.fn().mockResolvedValue(undefined);
		enqueueWebhook({ action: 'test' }, 'issue_comment');

		processNextQueuedWebhook(processWebhook, 'Test');

		// processWebhook is called via setImmediate — wait for it
		await new Promise((resolve) => setImmediate(resolve));

		expect(processWebhook).toHaveBeenCalledWith(
			{ action: 'test' },
			undefined, // eventType comes from getEventType, not the queued entry
			undefined, // no ackCommentId
			undefined, // no ackMessage
		);
	});

	it('uses getEventType to extract event type from queued entry', async () => {
		const processWebhook = vi.fn().mockResolvedValue(undefined);
		enqueueWebhook({ action: 'test' }, 'pull_request');

		processNextQueuedWebhook(processWebhook, 'Test', (entry) => entry.eventType);

		await new Promise((resolve) => setImmediate(resolve));

		expect(processWebhook).toHaveBeenCalledWith(
			{ action: 'test' },
			'pull_request',
			undefined,
			undefined,
		);
	});

	it('forwards ackCommentId through the queue', async () => {
		const processWebhook = vi.fn().mockResolvedValue(undefined);
		enqueueWebhook({ action: 'test' }, 'issue_comment', 'ack-123');

		processNextQueuedWebhook(processWebhook, 'Test', (entry) => entry.eventType);

		await new Promise((resolve) => setImmediate(resolve));

		expect(processWebhook).toHaveBeenCalledWith(
			{ action: 'test' },
			'issue_comment',
			'ack-123',
			undefined,
		);
	});

	it('forwards numeric ackCommentId through the queue', async () => {
		const processWebhook = vi.fn().mockResolvedValue(undefined);
		enqueueWebhook({ action: 'test' }, undefined, 10646);

		processNextQueuedWebhook(processWebhook, 'Test');

		await new Promise((resolve) => setImmediate(resolve));

		expect(processWebhook).toHaveBeenCalledWith({ action: 'test' }, undefined, 10646, undefined);
	});

	it('forwards ackMessage through the queue', async () => {
		const processWebhook = vi.fn().mockResolvedValue(undefined);
		enqueueWebhook({ action: 'test' }, 'issue_comment', 'ack-123', 'Looking into it...');

		processNextQueuedWebhook(processWebhook, 'Test', (entry) => entry.eventType);

		await new Promise((resolve) => setImmediate(resolve));

		expect(processWebhook).toHaveBeenCalledWith(
			{ action: 'test' },
			'issue_comment',
			'ack-123',
			'Looking into it...',
		);
	});

	it('processes items in FIFO order preserving ackCommentId', async () => {
		const processWebhook = vi.fn().mockResolvedValue(undefined);
		enqueueWebhook({ order: 1 }, undefined, 'first-ack');
		enqueueWebhook({ order: 2 }, undefined, 'second-ack');

		// Process first item
		processNextQueuedWebhook(processWebhook, 'Test');
		await new Promise((resolve) => setImmediate(resolve));

		expect(processWebhook).toHaveBeenCalledWith({ order: 1 }, undefined, 'first-ack', undefined);

		// Process second item
		processNextQueuedWebhook(processWebhook, 'Test');
		await new Promise((resolve) => setImmediate(resolve));

		expect(processWebhook).toHaveBeenCalledWith({ order: 2 }, undefined, 'second-ack', undefined);
	});
});
