import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/db/repositories/runsRepository.js', () => ({
	countActiveRunsForAgentType: vi.fn().mockResolvedValue(0),
}));
vi.mock('../../../src/db/repositories/settingsRepository.js', () => ({
	getMaxConcurrency: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../../src/utils/logging.js', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../src/router/config.js', () => ({
	routerConfig: { workerTimeoutMs: 30 * 60 * 1000 },
}));

import { countActiveRunsForAgentType } from '../../../src/db/repositories/runsRepository.js';
import { getMaxConcurrency } from '../../../src/db/repositories/settingsRepository.js';
import {
	checkAgentTypeConcurrency,
	clearAgentTypeEnqueued,
	clearAllAgentTypeLocks,
	isAgentTypeLocked,
	markAgentTypeEnqueued,
	markRecentlyDispatched,
	wasRecentlyDispatched,
} from '../../../src/router/agent-type-lock.js';

describe('agent-type-lock', () => {
	beforeEach(() => {
		clearAllAgentTypeLocks();
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	// ========================================================================
	// Layer 1: Concurrency Lock
	// ========================================================================

	describe('Layer 1: concurrency lock', () => {
		it('returns locked: false when no active run and no in-memory mark', async () => {
			const result = await isAgentTypeLocked('proj1', 'backlog-manager', 1);
			expect(result).toEqual({ locked: false });
			expect(countActiveRunsForAgentType).toHaveBeenCalledWith(
				'proj1',
				'backlog-manager',
				2 * 30 * 60 * 1000,
			);
		});

		it('returns locked: true after markAgentTypeEnqueued (maxConcurrency=1)', async () => {
			markAgentTypeEnqueued('proj1', 'backlog-manager');
			const result = await isAgentTypeLocked('proj1', 'backlog-manager', 1);
			expect(result.locked).toBe(true);
			expect(result.reason).toContain('in-memory');
		});

		it('allows second enqueue when maxConcurrency=2', async () => {
			markAgentTypeEnqueued('proj1', 'implementation');
			const result = await isAgentTypeLocked('proj1', 'implementation', 2);
			expect(result.locked).toBe(false);
		});

		it('blocks at maxConcurrency=2 with 2 enqueued', async () => {
			markAgentTypeEnqueued('proj1', 'implementation');
			markAgentTypeEnqueued('proj1', 'implementation');
			const result = await isAgentTypeLocked('proj1', 'implementation', 2);
			expect(result.locked).toBe(true);
		});

		it('clearAgentTypeEnqueued releases one slot', async () => {
			markAgentTypeEnqueued('proj1', 'backlog-manager');
			clearAgentTypeEnqueued('proj1', 'backlog-manager');
			const result = await isAgentTypeLocked('proj1', 'backlog-manager', 1);
			expect(result.locked).toBe(false);
		});

		it('returns locked: true when DB has active runs at limit', async () => {
			vi.mocked(countActiveRunsForAgentType).mockResolvedValueOnce(1);
			const result = await isAgentTypeLocked('proj1', 'backlog-manager', 1);
			expect(result.locked).toBe(true);
			expect(result.reason).toContain('running');
		});

		it('uses Math.max of in-memory and DB counts (not sum)', async () => {
			markAgentTypeEnqueued('proj1', 'implementation');
			vi.mocked(countActiveRunsForAgentType).mockResolvedValueOnce(1);
			// Math.max(1 DB, 1 in-memory) = 1 < 2 → NOT locked
			const result = await isAgentTypeLocked('proj1', 'implementation', 2);
			expect(result.locked).toBe(false);
		});

		it('locks when DB count alone meets max', async () => {
			vi.mocked(countActiveRunsForAgentType).mockResolvedValueOnce(2);
			const result = await isAgentTypeLocked('proj1', 'implementation', 2);
			expect(result.locked).toBe(true);
		});

		it('different projects are independent', async () => {
			markAgentTypeEnqueued('proj1', 'backlog-manager');

			const result1 = await isAgentTypeLocked('proj1', 'backlog-manager', 1);
			expect(result1.locked).toBe(true);

			const result2 = await isAgentTypeLocked('proj2', 'backlog-manager', 1);
			expect(result2.locked).toBe(false);
		});

		it('different agent types are independent', async () => {
			markAgentTypeEnqueued('proj1', 'backlog-manager');

			const result1 = await isAgentTypeLocked('proj1', 'backlog-manager', 1);
			expect(result1.locked).toBe(true);

			const result2 = await isAgentTypeLocked('proj1', 'implementation', 1);
			expect(result2.locked).toBe(false);
		});

		it('TTL expiry releases the in-memory lock', async () => {
			vi.useFakeTimers();
			markAgentTypeEnqueued('proj1', 'backlog-manager');

			// Advance past 30 minutes
			vi.advanceTimersByTime(30 * 60 * 1000 + 1);

			const result = await isAgentTypeLocked('proj1', 'backlog-manager', 1);
			expect(result.locked).toBe(false);
		});

		it('clearAllAgentTypeLocks clears all entries', async () => {
			markAgentTypeEnqueued('proj1', 'backlog-manager');
			markAgentTypeEnqueued('proj2', 'implementation');

			clearAllAgentTypeLocks();

			const result1 = await isAgentTypeLocked('proj1', 'backlog-manager', 1);
			expect(result1.locked).toBe(false);
			const result2 = await isAgentTypeLocked('proj2', 'implementation', 1);
			expect(result2.locked).toBe(false);
		});
	});

	// ========================================================================
	// Layer 2: Dedup Window
	// ========================================================================

	describe('Layer 2: dedup window', () => {
		it('returns false when not recently dispatched', () => {
			expect(wasRecentlyDispatched('proj1', 'backlog-manager')).toBe(false);
		});

		it('returns true after markRecentlyDispatched', () => {
			markRecentlyDispatched('proj1', 'backlog-manager');
			expect(wasRecentlyDispatched('proj1', 'backlog-manager')).toBe(true);
		});

		it('expires after 60 seconds', () => {
			vi.useFakeTimers();
			markRecentlyDispatched('proj1', 'backlog-manager');

			vi.advanceTimersByTime(60 * 1000 + 1);

			expect(wasRecentlyDispatched('proj1', 'backlog-manager')).toBe(false);
		});

		it('is NOT cleared by clearAgentTypeEnqueued', () => {
			markRecentlyDispatched('proj1', 'backlog-manager');
			clearAgentTypeEnqueued('proj1', 'backlog-manager');
			expect(wasRecentlyDispatched('proj1', 'backlog-manager')).toBe(true);
		});

		it('is cleared by clearAllAgentTypeLocks', () => {
			markRecentlyDispatched('proj1', 'backlog-manager');
			clearAllAgentTypeLocks();
			expect(wasRecentlyDispatched('proj1', 'backlog-manager')).toBe(false);
		});

		it('different projects are independent', () => {
			markRecentlyDispatched('proj1', 'backlog-manager');
			expect(wasRecentlyDispatched('proj1', 'backlog-manager')).toBe(true);
			expect(wasRecentlyDispatched('proj2', 'backlog-manager')).toBe(false);
		});

		it('different agent types are independent', () => {
			markRecentlyDispatched('proj1', 'backlog-manager');
			expect(wasRecentlyDispatched('proj1', 'backlog-manager')).toBe(true);
			expect(wasRecentlyDispatched('proj1', 'implementation')).toBe(false);
		});
	});

	// ========================================================================
	// Combined: checkAgentTypeConcurrency
	// ========================================================================

	describe('checkAgentTypeConcurrency', () => {
		it('returns blocked: false when no maxConcurrency configured', async () => {
			vi.mocked(getMaxConcurrency).mockResolvedValueOnce(null);
			const result = await checkAgentTypeConcurrency('proj1', 'implementation');
			expect(result).toEqual({ maxConcurrency: null, blocked: false });
		});

		it('returns blocked: true when recently dispatched', async () => {
			vi.mocked(getMaxConcurrency).mockResolvedValueOnce(1);
			markRecentlyDispatched('proj1', 'implementation');
			const result = await checkAgentTypeConcurrency('proj1', 'implementation');
			expect(result.blocked).toBe(true);
			expect(result.maxConcurrency).toBe(1);
		});

		it('returns blocked: true when agent type is locked', async () => {
			vi.mocked(getMaxConcurrency).mockResolvedValueOnce(1);
			markAgentTypeEnqueued('proj1', 'implementation');
			const result = await checkAgentTypeConcurrency('proj1', 'implementation');
			expect(result.blocked).toBe(true);
		});

		it('returns blocked: false when under limit', async () => {
			vi.mocked(getMaxConcurrency).mockResolvedValueOnce(2);
			const result = await checkAgentTypeConcurrency('proj1', 'implementation');
			expect(result).toEqual({ maxConcurrency: 2, blocked: false });
		});

		it('proceeds without limit when getMaxConcurrency throws', async () => {
			vi.mocked(getMaxConcurrency).mockRejectedValueOnce(new Error('DB down'));
			const result = await checkAgentTypeConcurrency('proj1', 'implementation');
			expect(result).toEqual({ maxConcurrency: null, blocked: false });
		});
	});
});
