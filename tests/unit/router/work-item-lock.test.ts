import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/db/repositories/runsRepository.js', () => ({
	countActiveRuns: vi.fn().mockResolvedValue(0),
}));
vi.mock('../../../src/utils/logging.js', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../src/router/config.js', () => ({
	routerConfig: { workerTimeoutMs: 30 * 60 * 1000 },
}));

import { countActiveRuns } from '../../../src/db/repositories/runsRepository.js';
import {
	MAX_SAME_TYPE_PER_WORK_ITEM,
	MAX_WORK_ITEM_CONCURRENCY,
	clearAllWorkItemLocks,
	clearWorkItemEnqueued,
	isWorkItemLocked,
	markWorkItemEnqueued,
} from '../../../src/router/work-item-lock.js';

describe('work-item-lock', () => {
	beforeEach(() => {
		clearAllWorkItemLocks();
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns locked: false when no active run and no in-memory mark', async () => {
		const result = await isWorkItemLocked('proj1', 'card1', 'implementation');
		expect(result).toEqual({ locked: false });
		const maxAgeMs = 2 * 30 * 60 * 1000;
		// Two parallel countActiveRuns calls: one for total (workItemId only) and one for same-type
		expect(countActiveRuns).toHaveBeenCalledWith({
			projectId: 'proj1',
			workItemId: 'card1',
			maxAgeMs,
		});
		expect(countActiveRuns).toHaveBeenCalledWith({
			projectId: 'proj1',
			workItemId: 'card1',
			agentType: 'implementation',
			maxAgeMs,
		});
	});

	it('1 enqueued agent does not lock (1 < MAX_WORK_ITEM_CONCURRENCY)', async () => {
		markWorkItemEnqueued('proj1', 'card1', 'implementation');
		const result = await isWorkItemLocked('proj1', 'card1', 'review');
		expect(result.locked).toBe(false);
	});

	it('1 enqueued agent locks same type (same-type limit = 1)', async () => {
		markWorkItemEnqueued('proj1', 'card1', 'implementation');
		const result = await isWorkItemLocked('proj1', 'card1', 'implementation');
		expect(result.locked).toBe(true);
		expect(result.reason).toContain('same-type');
	});

	it('2 enqueued agents of different types locks (total = MAX_WORK_ITEM_CONCURRENCY)', async () => {
		markWorkItemEnqueued('proj1', 'card1', 'implementation');
		markWorkItemEnqueued('proj1', 'card1', 'review');
		const result = await isWorkItemLocked('proj1', 'card1', 'debug');
		expect(result.locked).toBe(true);
		expect(result.reason).toContain('total');
	});

	it('clearWorkItemEnqueued decrements count, does not immediately delete', async () => {
		markWorkItemEnqueued('proj1', 'card1', 'implementation');
		markWorkItemEnqueued('proj1', 'card1', 'implementation');
		clearWorkItemEnqueued('proj1', 'card1', 'implementation');
		// Should still be locked for same type (count went from 2 to 1)
		const result = await isWorkItemLocked('proj1', 'card1', 'implementation');
		expect(result.locked).toBe(true);
	});

	it('clearWorkItemEnqueued fully releases when count reaches 0', async () => {
		markWorkItemEnqueued('proj1', 'card1', 'implementation');
		clearWorkItemEnqueued('proj1', 'card1', 'implementation');
		const result = await isWorkItemLocked('proj1', 'card1', 'implementation');
		expect(result.locked).toBe(false);
	});

	it('DB count of 1 does not lock for different type', async () => {
		// First call (total): 1, second call (same-type): 0
		vi.mocked(countActiveRuns).mockResolvedValueOnce(1).mockResolvedValueOnce(0);
		const result = await isWorkItemLocked('proj1', 'card1', 'review');
		expect(result.locked).toBe(false);
	});

	it('DB total count of 2 locks', async () => {
		// First call (total): 2, second call (same-type): 0
		vi.mocked(countActiveRuns).mockResolvedValueOnce(2).mockResolvedValueOnce(0);
		const result = await isWorkItemLocked('proj1', 'card1', 'review');
		expect(result.locked).toBe(true);
		expect(result.reason).toContain('total');
	});

	it('DB same-type count of 1 locks for same type', async () => {
		// First call (total): 1, second call (same-type): 1
		vi.mocked(countActiveRuns).mockResolvedValueOnce(1).mockResolvedValueOnce(1);
		const result = await isWorkItemLocked('proj1', 'card1', 'implementation');
		expect(result.locked).toBe(true);
		expect(result.reason).toContain('same-type');
	});

	it('DB same-type count of 1 does not lock for different type when total < max', async () => {
		// First call (total): 1, second call (same-type for 'review'): 0
		vi.mocked(countActiveRuns).mockResolvedValueOnce(1).mockResolvedValueOnce(0);
		const result = await isWorkItemLocked('proj1', 'card1', 'review');
		expect(result.locked).toBe(false);
	});

	it('TTL expiry releases the in-memory lock', async () => {
		vi.useFakeTimers();
		markWorkItemEnqueued('proj1', 'card1', 'implementation');

		// Advance past 30 minutes
		vi.advanceTimersByTime(30 * 60 * 1000 + 1);

		const result = await isWorkItemLocked('proj1', 'card1', 'implementation');
		expect(result.locked).toBe(false);
		expect(countActiveRuns).toHaveBeenCalled();
	});

	it('different projects with same workItemId are independent', async () => {
		markWorkItemEnqueued('proj1', 'card1', 'implementation');

		const result1 = await isWorkItemLocked('proj1', 'card1', 'implementation');
		expect(result1.locked).toBe(true);

		const result2 = await isWorkItemLocked('proj2', 'card1', 'implementation');
		expect(result2.locked).toBe(false);
	});

	it('clearAllWorkItemLocks clears all entries', async () => {
		markWorkItemEnqueued('proj1', 'card1', 'implementation');
		markWorkItemEnqueued('proj2', 'card2', 'review');

		clearAllWorkItemLocks();

		const result1 = await isWorkItemLocked('proj1', 'card1', 'implementation');
		expect(result1.locked).toBe(false);
		const result2 = await isWorkItemLocked('proj2', 'card2', 'review');
		expect(result2.locked).toBe(false);
	});

	it('short-circuits on in-memory same-type without DB query', async () => {
		markWorkItemEnqueued('proj1', 'card1', 'implementation');
		const result = await isWorkItemLocked('proj1', 'card1', 'implementation');
		expect(result.locked).toBe(true);
		expect(result.reason).toContain('in-memory same-type');
		// DB should not have been called
		expect(countActiveRuns).not.toHaveBeenCalled();
	});

	it('short-circuits on in-memory total without DB query', async () => {
		markWorkItemEnqueued('proj1', 'card1', 'implementation');
		markWorkItemEnqueued('proj1', 'card1', 'review');
		const result = await isWorkItemLocked('proj1', 'card1', 'debug');
		expect(result.locked).toBe(true);
		expect(result.reason).toContain('in-memory total');
		expect(countActiveRuns).not.toHaveBeenCalled();
	});
});
