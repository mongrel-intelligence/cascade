import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/db/repositories/runsRepository.js', () => ({
	hasActiveRunForWorkItem: vi.fn().mockResolvedValue(false),
}));
vi.mock('../../../src/utils/logging.js', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../src/router/config.js', () => ({
	routerConfig: { workerTimeoutMs: 30 * 60 * 1000 },
}));

import { hasActiveRunForWorkItem } from '../../../src/db/repositories/runsRepository.js';
import {
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
		const result = await isWorkItemLocked('proj1', 'card1');
		expect(result).toEqual({ locked: false });
		// maxAgeMs = 2 * workerTimeoutMs = 60 min
		expect(hasActiveRunForWorkItem).toHaveBeenCalledWith('proj1', 'card1', 2 * 30 * 60 * 1000);
	});

	it('returns locked: true after markWorkItemEnqueued', async () => {
		markWorkItemEnqueued('proj1', 'card1');
		const result = await isWorkItemLocked('proj1', 'card1');
		expect(result.locked).toBe(true);
		expect(result.reason).toContain('in-memory');
		// Should not hit DB when in-memory lock is present
		expect(hasActiveRunForWorkItem).not.toHaveBeenCalled();
	});

	it('clearWorkItemEnqueued releases the lock', async () => {
		markWorkItemEnqueued('proj1', 'card1');
		clearWorkItemEnqueued('proj1', 'card1');
		const result = await isWorkItemLocked('proj1', 'card1');
		expect(result.locked).toBe(false);
	});

	it('TTL expiry releases the in-memory lock', async () => {
		vi.useFakeTimers();
		markWorkItemEnqueued('proj1', 'card1');

		// Advance past 30 minutes
		vi.advanceTimersByTime(30 * 60 * 1000 + 1);

		const maxAgeMs = 2 * 30 * 60 * 1000;
		const result = await isWorkItemLocked('proj1', 'card1');
		// In-memory lock should have expired, falls through to DB check
		expect(result.locked).toBe(false);
		expect(hasActiveRunForWorkItem).toHaveBeenCalledWith('proj1', 'card1', maxAgeMs);
		// Verify the expired entry was cleaned up by checking it's no longer locked in-memory
		vi.mocked(hasActiveRunForWorkItem).mockClear();
		const result2 = await isWorkItemLocked('proj1', 'card1');
		expect(result2.locked).toBe(false);
		// Should go straight to DB check (no in-memory entry left)
		expect(hasActiveRunForWorkItem).toHaveBeenCalledWith('proj1', 'card1', maxAgeMs);
	});

	it('returns locked: true when DB has an active run', async () => {
		vi.mocked(hasActiveRunForWorkItem).mockResolvedValueOnce(true);
		const result = await isWorkItemLocked('proj1', 'card1');
		expect(result).toEqual({ locked: true, reason: 'db: active run exists' });
	});

	it('different projects with same workItemId are independent', async () => {
		markWorkItemEnqueued('proj1', 'card1');

		const result1 = await isWorkItemLocked('proj1', 'card1');
		expect(result1.locked).toBe(true);

		const result2 = await isWorkItemLocked('proj2', 'card1');
		expect(result2.locked).toBe(false);
	});

	it('clearAllWorkItemLocks clears all entries', async () => {
		markWorkItemEnqueued('proj1', 'card1');
		markWorkItemEnqueued('proj2', 'card2');

		clearAllWorkItemLocks();

		// Both should now be unlocked (falls through to DB which returns false)
		const result1 = await isWorkItemLocked('proj1', 'card1');
		expect(result1.locked).toBe(false);
		const result2 = await isWorkItemLocked('proj2', 'card2');
		expect(result2.locked).toBe(false);
	});
});
