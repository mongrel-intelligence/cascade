import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/router/active-workers.js', () => ({
	getActiveWorkerCount: vi.fn(),
}));

vi.mock('../../../src/router/config.js', () => ({
	routerConfig: { maxWorkers: 1 },
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { getActiveWorkerCount } from '../../../src/router/active-workers.js';
import { routerConfig } from '../../../src/router/config.js';
import { acquireSlot, clearAllWaiters, slotReleased } from '../../../src/router/slot-waiter.js';

const mockGetActiveWorkerCount = vi.mocked(getActiveWorkerCount);

describe('slot-waiter', () => {
	beforeEach(() => {
		mockGetActiveWorkerCount.mockReset();
		clearAllWaiters();
		// Default: maxWorkers=1
		(routerConfig as { maxWorkers: number }).maxWorkers = 1;
	});

	afterEach(() => {
		vi.useRealTimers();
		clearAllWaiters();
	});

	it('resolves immediately when capacity is below max', async () => {
		(routerConfig as { maxWorkers: number }).maxWorkers = 3;
		mockGetActiveWorkerCount.mockReturnValue(1);
		await expect(acquireSlot({ timeoutMs: 1000 })).resolves.toBeUndefined();
	});

	it('suspends when at capacity, resolves when a slot frees', async () => {
		mockGetActiveWorkerCount.mockReturnValue(1);
		const acquired = acquireSlot({ timeoutMs: 5000 });

		// One microtask turn — promise should still be pending
		let settled = false;
		void acquired.then(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false);

		// Free up a slot — waiter resolves
		slotReleased();
		await acquired;
		expect(settled).toBe(true);
	});

	it('rejects with code SLOT_WAIT_TIMEOUT if no slot frees in time', async () => {
		vi.useFakeTimers();
		mockGetActiveWorkerCount.mockReturnValue(1);
		const acquired = acquireSlot({ timeoutMs: 50 });
		// Capture the rejection so it doesn't bubble as unhandled
		const rejectionSpy = vi.fn();
		acquired.catch(rejectionSpy);

		await vi.advanceTimersByTimeAsync(60);

		expect(rejectionSpy).toHaveBeenCalledTimes(1);
		const err = rejectionSpy.mock.calls[0][0];
		expect(err).toBeInstanceOf(Error);
		expect((err as { code?: string }).code).toBe('SLOT_WAIT_TIMEOUT');
	});

	it('multiple waiters resolve FIFO as slots free', async () => {
		mockGetActiveWorkerCount.mockReturnValue(1);
		const order: number[] = [];
		const w1 = acquireSlot({ timeoutMs: 5000 }).then(() => order.push(1));
		const w2 = acquireSlot({ timeoutMs: 5000 }).then(() => order.push(2));
		const w3 = acquireSlot({ timeoutMs: 5000 }).then(() => order.push(3));

		await Promise.resolve();
		expect(order).toEqual([]);

		slotReleased();
		await Promise.resolve();
		await Promise.resolve();
		expect(order).toEqual([1]);

		slotReleased();
		await Promise.resolve();
		await Promise.resolve();
		expect(order).toEqual([1, 2]);

		slotReleased();
		await Promise.all([w1, w2, w3]);
		expect(order).toEqual([1, 2, 3]);
	});

	it('slotReleased called with no waiters is a no-op (does not throw)', () => {
		expect(() => slotReleased()).not.toThrow();
	});

	it('slotReleased does not double-release waiters when called multiple times in rapid succession', async () => {
		mockGetActiveWorkerCount.mockReturnValue(1);
		const acquired = acquireSlot({ timeoutMs: 5000 });
		const resolveSpy = vi.fn();
		acquired.then(resolveSpy);

		slotReleased();
		slotReleased(); // Extra release — must not double-resolve the same waiter
		slotReleased();

		await acquired;
		// Microtask drain
		await Promise.resolve();
		expect(resolveSpy).toHaveBeenCalledTimes(1);
	});

	it('clearAllWaiters rejects pending waiters with code SHUTDOWN', async () => {
		mockGetActiveWorkerCount.mockReturnValue(1);
		const acquired = acquireSlot({ timeoutMs: 5000 });
		const rejectionSpy = vi.fn();
		acquired.catch(rejectionSpy);

		clearAllWaiters();
		await Promise.resolve();
		await Promise.resolve();

		expect(rejectionSpy).toHaveBeenCalledTimes(1);
		const err = rejectionSpy.mock.calls[0][0];
		expect((err as { code?: string }).code).toBe('SHUTDOWN');
	});
});
