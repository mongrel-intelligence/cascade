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
	clearAllWorkItemLocks,
	clearWorkItemEnqueued,
	isWorkItemLocked,
	markWorkItemEnqueued,
} from '../../../src/router/work-item-lock.js';

describe('work-item-lock', () => {
	beforeEach(() => {
		clearAllWorkItemLocks();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns locked: false when no active run and no in-memory mark', async () => {
		const result = await isWorkItemLocked('proj1', 'card1', 'implementation');
		expect(result).toEqual({ locked: false });
		const maxAgeMs = 2 * 30 * 60 * 1000;
		// Only one DB query: same-type count (no total query — total cap removed)
		expect(countActiveRuns).toHaveBeenCalledTimes(1);
		expect(countActiveRuns).toHaveBeenCalledWith({
			projectId: 'proj1',
			workItemId: 'card1',
			agentType: 'implementation',
			maxAgeMs,
		});
	});

	it('1 enqueued agent of different type does not lock (per-type only)', async () => {
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

	it('allows 3+ different agent types concurrently (no total cap)', async () => {
		markWorkItemEnqueued('proj1', 'card1', 'implementation');
		markWorkItemEnqueued('proj1', 'card1', 'review');
		const result = await isWorkItemLocked('proj1', 'card1', 'debug');
		expect(result.locked).toBe(false);
	});

	it('allows review dispatch while implementation is enqueued', async () => {
		markWorkItemEnqueued('proj1', 'card1', 'implementation');
		const result = await isWorkItemLocked('proj1', 'card1', 'review');
		expect(result.locked).toBe(false);
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
		// Single DB call: same-type count for 'review' is 0
		vi.mocked(countActiveRuns).mockResolvedValueOnce(0);
		const result = await isWorkItemLocked('proj1', 'card1', 'review');
		expect(result.locked).toBe(false);
	});

	it('DB total count irrelevant for cross-type dispatch (total cap removed)', async () => {
		// Only one DB call now: same-type. Return 0 for it.
		vi.mocked(countActiveRuns).mockResolvedValueOnce(0);
		const result = await isWorkItemLocked('proj1', 'card1', 'review');
		expect(result.locked).toBe(false);
	});

	it('DB same-type count of 1 locks for same type', async () => {
		vi.mocked(countActiveRuns).mockResolvedValueOnce(1);
		const result = await isWorkItemLocked('proj1', 'card1', 'implementation');
		expect(result.locked).toBe(true);
		expect(result.reason).toContain('same-type');
	});

	it('DB same-type count of 0 does not lock for different type', async () => {
		vi.mocked(countActiveRuns).mockResolvedValueOnce(0);
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

	it('does NOT short-circuit on in-memory total (total cap removed)', async () => {
		markWorkItemEnqueued('proj1', 'card1', 'implementation');
		markWorkItemEnqueued('proj1', 'card1', 'review');
		const result = await isWorkItemLocked('proj1', 'card1', 'debug');
		// No total cap — 'debug' same-type is 0, so unlocked
		expect(result.locked).toBe(false);
	});

	// ── Project-singleton agents (backlog-manager) ──────────────────────────
	// Backlog-manager scans the whole project backlog and selects the next
	// item to move to TODO. Two parallel runs (e.g. one chained from
	// MNG-536's PR merge, one from MNG-537's splitting auto-chain) both
	// scan the same backlog and both can pick the same item — producing
	// duplicate downstream implementation runs (live incident 2026-05-06,
	// MNG-538: PRs #287 and #288). Per-(projectId, workItemId, agentType)
	// locking did NOT serialize them because workItemId differed (MNG-536
	// vs MNG-537). The fix collapses workItemId for project-singleton
	// agents so the lock is per-(projectId, agentType).
	describe('project-singleton agents (backlog-manager)', () => {
		it('blocks a second backlog-manager on a different workItemId in the same project', async () => {
			markWorkItemEnqueued('proj1', 'MNG-536', 'backlog-manager');
			const result = await isWorkItemLocked('proj1', 'MNG-537', 'backlog-manager');
			expect(result.locked).toBe(true);
			expect(result.reason).toMatch(/singleton|same-type/i);
		});

		it('does NOT block backlog-manager across different projects', async () => {
			markWorkItemEnqueued('proj1', 'MNG-536', 'backlog-manager');
			const result = await isWorkItemLocked('proj2', 'MNG-536', 'backlog-manager');
			expect(result.locked).toBe(false);
		});

		it('clearWorkItemEnqueued releases backlog-manager regardless of workItemId', async () => {
			markWorkItemEnqueued('proj1', 'MNG-536', 'backlog-manager');
			// Cleared with the same workItemId it was marked with — normal cleanup path.
			clearWorkItemEnqueued('proj1', 'MNG-536', 'backlog-manager');
			const result = await isWorkItemLocked('proj1', 'MNG-537', 'backlog-manager');
			expect(result.locked).toBe(false);
		});

		it('does NOT block other agent types on the same project', async () => {
			markWorkItemEnqueued('proj1', 'MNG-536', 'backlog-manager');
			const result = await isWorkItemLocked('proj1', 'MNG-538', 'implementation');
			expect(result.locked).toBe(false);
		});

		it('DB query for backlog-manager omits workItemId so all project rows are counted', async () => {
			vi.mocked(countActiveRuns).mockResolvedValueOnce(1);
			const result = await isWorkItemLocked('proj1', 'MNG-537', 'backlog-manager');
			expect(result.locked).toBe(true);
			const maxAgeMs = 2 * 30 * 60 * 1000;
			expect(countActiveRuns).toHaveBeenCalledWith({
				projectId: 'proj1',
				agentType: 'backlog-manager',
				maxAgeMs,
			});
		});

		it('regular per-work-item agents still pass workItemId in the DB query', async () => {
			vi.mocked(countActiveRuns).mockResolvedValueOnce(0);
			await isWorkItemLocked('proj1', 'card1', 'implementation');
			const maxAgeMs = 2 * 30 * 60 * 1000;
			expect(countActiveRuns).toHaveBeenCalledWith({
				projectId: 'proj1',
				workItemId: 'card1',
				agentType: 'implementation',
				maxAgeMs,
			});
		});
	});
});
