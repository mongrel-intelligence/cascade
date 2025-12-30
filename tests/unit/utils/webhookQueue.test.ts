import { afterEach, describe, expect, it } from 'vitest';
import {
	clearQueue,
	dequeueWebhook,
	enqueueWebhook,
	getMaxQueueSize,
	getQueueLength,
} from '../../../src/utils/webhookQueue.js';

describe('webhookQueue', () => {
	afterEach(() => {
		clearQueue();
	});

	describe('enqueueWebhook', () => {
		it('adds a webhook to the queue', () => {
			const payload = { action: { type: 'test' } };

			const result = enqueueWebhook(payload);

			expect(result).toBe(true);
			expect(getQueueLength()).toBe(1);
		});

		it('accepts multiple webhooks up to the limit', () => {
			const maxSize = getMaxQueueSize();

			for (let i = 0; i < maxSize; i++) {
				const result = enqueueWebhook({ index: i });
				expect(result).toBe(true);
			}

			expect(getQueueLength()).toBe(maxSize);
		});

		it('rejects webhooks when queue is full', () => {
			const maxSize = getMaxQueueSize();

			// Fill the queue
			for (let i = 0; i < maxSize; i++) {
				enqueueWebhook({ index: i });
			}

			// Try to add one more
			const result = enqueueWebhook({ index: maxSize });

			expect(result).toBe(false);
			expect(getQueueLength()).toBe(maxSize);
		});
	});

	describe('dequeueWebhook', () => {
		it('returns undefined for empty queue', () => {
			const result = dequeueWebhook();

			expect(result).toBeUndefined();
		});

		it('returns and removes the first item (FIFO)', () => {
			enqueueWebhook({ value: 'first' });
			enqueueWebhook({ value: 'second' });
			enqueueWebhook({ value: 'third' });

			const first = dequeueWebhook();
			const second = dequeueWebhook();
			const third = dequeueWebhook();

			expect(first?.payload).toEqual({ value: 'first' });
			expect(second?.payload).toEqual({ value: 'second' });
			expect(third?.payload).toEqual({ value: 'third' });
			expect(getQueueLength()).toBe(0);
		});

		it('includes receivedAt timestamp', () => {
			const before = new Date();
			enqueueWebhook({ test: true });
			const after = new Date();

			const item = dequeueWebhook();

			expect(item).toBeDefined();
			expect(item?.receivedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
			expect(item?.receivedAt.getTime()).toBeLessThanOrEqual(after.getTime());
		});
	});

	describe('getQueueLength', () => {
		it('returns 0 for empty queue', () => {
			expect(getQueueLength()).toBe(0);
		});

		it('tracks queue size correctly', () => {
			enqueueWebhook({ a: 1 });
			expect(getQueueLength()).toBe(1);

			enqueueWebhook({ b: 2 });
			expect(getQueueLength()).toBe(2);

			dequeueWebhook();
			expect(getQueueLength()).toBe(1);

			dequeueWebhook();
			expect(getQueueLength()).toBe(0);
		});
	});

	describe('clearQueue', () => {
		it('removes all items from the queue', () => {
			enqueueWebhook({ a: 1 });
			enqueueWebhook({ b: 2 });
			enqueueWebhook({ c: 3 });

			clearQueue();

			expect(getQueueLength()).toBe(0);
			expect(dequeueWebhook()).toBeUndefined();
		});

		it('allows new items after clearing', () => {
			enqueueWebhook({ old: true });
			clearQueue();

			const result = enqueueWebhook({ new: true });

			expect(result).toBe(true);
			expect(getQueueLength()).toBe(1);
			expect(dequeueWebhook()?.payload).toEqual({ new: true });
		});
	});

	describe('getMaxQueueSize', () => {
		it('returns the maximum queue size', () => {
			const maxSize = getMaxQueueSize();

			expect(maxSize).toBe(10);
		});
	});
});
