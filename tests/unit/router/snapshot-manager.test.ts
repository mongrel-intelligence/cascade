import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

vi.mock('../../../src/router/config.js', () => ({
	routerConfig: {
		snapshotEnabled: false,
		snapshotDefaultTtlMs: 86400000, // 24h default
		snapshotMaxCount: 5,
		snapshotMaxSizeBytes: 10737418240,
	},
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { routerConfig } from '../../../src/router/config.js';
import {
	_clearAllSnapshots,
	evictSnapshots,
	getSnapshot,
	getSnapshotCount,
	invalidateSnapshot,
	registerSnapshot,
} from '../../../src/router/snapshot-manager.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('snapshot-manager', () => {
	beforeEach(() => {
		_clearAllSnapshots();
	});

	afterEach(() => {
		_clearAllSnapshots();
		vi.clearAllMocks();
	});

	// -------------------------------------------------------------------------
	// registerSnapshot
	// -------------------------------------------------------------------------

	describe('registerSnapshot', () => {
		it('registers snapshot metadata and returns it', () => {
			const result = registerSnapshot('proj-1', 'card-abc', 'my-image:latest');

			expect(result).toMatchObject({
				imageName: 'my-image:latest',
				projectId: 'proj-1',
				workItemId: 'card-abc',
			});
			expect(result.createdAt).toBeInstanceOf(Date);
		});

		it('can register snapshots for different project+workItem pairs', () => {
			registerSnapshot('proj-1', 'card-1', 'image-1:latest');
			registerSnapshot('proj-1', 'card-2', 'image-2:latest');
			registerSnapshot('proj-2', 'card-1', 'image-3:latest');

			expect(getSnapshotCount()).toBe(3);
		});

		it('overwrites existing snapshot for the same key', () => {
			registerSnapshot('proj-1', 'card-abc', 'old-image:latest');
			registerSnapshot('proj-1', 'card-abc', 'new-image:latest');

			const snapshot = getSnapshot('proj-1', 'card-abc');
			expect(snapshot?.imageName).toBe('new-image:latest');
			expect(getSnapshotCount()).toBe(1);
		});

		it('sets createdAt to current time', () => {
			const before = new Date();
			const result = registerSnapshot('proj-1', 'card-abc', 'img:latest');
			const after = new Date();

			expect(result.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
			expect(result.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
		});
	});

	// -------------------------------------------------------------------------
	// getSnapshot
	// -------------------------------------------------------------------------

	describe('getSnapshot', () => {
		it('returns undefined when no snapshot exists', () => {
			expect(getSnapshot('proj-missing', 'card-missing')).toBeUndefined();
		});

		it('returns registered snapshot metadata', () => {
			registerSnapshot('proj-1', 'card-abc', 'my-image:latest');

			const snapshot = getSnapshot('proj-1', 'card-abc');
			expect(snapshot).toBeDefined();
			expect(snapshot?.imageName).toBe('my-image:latest');
			expect(snapshot?.projectId).toBe('proj-1');
			expect(snapshot?.workItemId).toBe('card-abc');
		});

		it('returns undefined for a different project with the same workItem', () => {
			registerSnapshot('proj-1', 'card-abc', 'my-image:latest');

			expect(getSnapshot('proj-2', 'card-abc')).toBeUndefined();
		});

		it('returns undefined for a different workItem with the same project', () => {
			registerSnapshot('proj-1', 'card-abc', 'my-image:latest');

			expect(getSnapshot('proj-1', 'card-xyz')).toBeUndefined();
		});

		it('returns undefined and evicts an expired snapshot', () => {
			// Register a snapshot with a createdAt in the past
			const expired = registerSnapshot('proj-1', 'card-abc', 'old-image:latest');
			// Backdate createdAt beyond the TTL
			const originalTtl = routerConfig.snapshotDefaultTtlMs;
			(routerConfig as { snapshotDefaultTtlMs: number }).snapshotDefaultTtlMs = 1000;
			// Set createdAt to 2 seconds ago so it's past the 1000ms TTL
			expired.createdAt = new Date(Date.now() - 2000);

			expect(getSnapshot('proj-1', 'card-abc')).toBeUndefined();
			expect(getSnapshotCount()).toBe(0);

			// Restore original TTL
			(routerConfig as { snapshotDefaultTtlMs: number }).snapshotDefaultTtlMs = originalTtl;
		});

		it('returns a valid snapshot that has not yet expired', () => {
			const snapshot = registerSnapshot('proj-1', 'card-abc', 'fresh-image:latest');
			// Ensure createdAt is very recent (just now)
			snapshot.createdAt = new Date();

			expect(getSnapshot('proj-1', 'card-abc')).toBeDefined();
			expect(getSnapshotCount()).toBe(1);
		});

		it('respects an explicit ttlMs override (per-project TTL)', () => {
			// Register a snapshot created 2 seconds ago
			const snap = registerSnapshot('proj-1', 'card-abc', 'img:latest');
			snap.createdAt = new Date(Date.now() - 2000);

			// With a 5-second TTL the snapshot is still fresh
			expect(getSnapshot('proj-1', 'card-abc', 5000)).toBeDefined();
			// With a 1-second TTL the snapshot is expired
			expect(getSnapshot('proj-1', 'card-abc', 1000)).toBeUndefined();
			expect(getSnapshotCount()).toBe(0);
		});

		it('uses global snapshotDefaultTtlMs when no ttlMs is passed', () => {
			const originalTtl = routerConfig.snapshotDefaultTtlMs;
			(routerConfig as { snapshotDefaultTtlMs: number }).snapshotDefaultTtlMs = 1000;

			const snap = registerSnapshot('proj-1', 'card-abc', 'img:latest');
			snap.createdAt = new Date(Date.now() - 2000);

			// No ttlMs argument — should fall back to routerConfig.snapshotDefaultTtlMs (1000ms)
			expect(getSnapshot('proj-1', 'card-abc')).toBeUndefined();
			expect(getSnapshotCount()).toBe(0);

			(routerConfig as { snapshotDefaultTtlMs: number }).snapshotDefaultTtlMs = originalTtl;
		});
	});

	// -------------------------------------------------------------------------
	// invalidateSnapshot
	// -------------------------------------------------------------------------

	describe('invalidateSnapshot', () => {
		it('removes a registered snapshot', () => {
			registerSnapshot('proj-1', 'card-abc', 'my-image:latest');
			invalidateSnapshot('proj-1', 'card-abc');

			expect(getSnapshot('proj-1', 'card-abc')).toBeUndefined();
			expect(getSnapshotCount()).toBe(0);
		});

		it('is a no-op when no snapshot exists for the key', () => {
			expect(() => invalidateSnapshot('proj-missing', 'card-missing')).not.toThrow();
		});

		it('only removes the targeted snapshot, leaving others intact', () => {
			registerSnapshot('proj-1', 'card-1', 'image-1:latest');
			registerSnapshot('proj-1', 'card-2', 'image-2:latest');

			invalidateSnapshot('proj-1', 'card-1');

			expect(getSnapshot('proj-1', 'card-1')).toBeUndefined();
			expect(getSnapshot('proj-1', 'card-2')).toBeDefined();
			expect(getSnapshotCount()).toBe(1);
		});
	});

	// -------------------------------------------------------------------------
	// getSnapshotCount
	// -------------------------------------------------------------------------

	describe('getSnapshotCount', () => {
		it('returns 0 when no snapshots are registered', () => {
			expect(getSnapshotCount()).toBe(0);
		});

		it('returns the correct count after registering multiple snapshots', () => {
			registerSnapshot('proj-1', 'card-1', 'img-1:latest');
			registerSnapshot('proj-1', 'card-2', 'img-2:latest');
			registerSnapshot('proj-2', 'card-1', 'img-3:latest');

			expect(getSnapshotCount()).toBe(3);
		});

		it('decrements after invalidation', () => {
			registerSnapshot('proj-1', 'card-1', 'img-1:latest');
			registerSnapshot('proj-1', 'card-2', 'img-2:latest');

			invalidateSnapshot('proj-1', 'card-1');

			expect(getSnapshotCount()).toBe(1);
		});
	});

	// -------------------------------------------------------------------------
	// evictSnapshots
	// -------------------------------------------------------------------------

	describe('evictSnapshots', () => {
		it('returns 0 when no snapshots are registered', () => {
			expect(evictSnapshots(1000, 5, 10 * 1024 * 1024 * 1024)).toBe(0);
		});

		it('evicts expired snapshots by TTL', () => {
			const snap1 = registerSnapshot('proj-1', 'card-1', 'img-1:latest');
			const _snap2 = registerSnapshot('proj-1', 'card-2', 'img-2:latest');

			// Backdate snap1 so it's expired
			snap1.createdAt = new Date(Date.now() - 2000);
			// snap2 is fresh

			const evicted = evictSnapshots(1000, 10, 10 * 1024 * 1024 * 1024);

			expect(evicted).toBe(1);
			expect(getSnapshotCount()).toBe(1);
			expect(getSnapshot('proj-1', 'card-2')).toBeDefined();
			expect(getSnapshot('proj-1', 'card-1', 1000)).toBeUndefined();
		});

		it('evicts oldest snapshots when max-count is exceeded', () => {
			const s1 = registerSnapshot('proj-1', 'card-1', 'img-1:latest');
			const s2 = registerSnapshot('proj-1', 'card-2', 'img-2:latest');
			const s3 = registerSnapshot('proj-1', 'card-3', 'img-3:latest');

			// Make s1 oldest and s3 newest
			s1.createdAt = new Date(Date.now() - 3000);
			s2.createdAt = new Date(Date.now() - 2000);
			s3.createdAt = new Date(Date.now() - 1000);

			// Allow all TTL, but cap at 2 snapshots
			const evicted = evictSnapshots(24 * 60 * 60 * 1000, 2, 10 * 1024 * 1024 * 1024);

			expect(evicted).toBe(1);
			expect(getSnapshotCount()).toBe(2);
			// s1 (oldest) should have been evicted
			expect(getSnapshot('proj-1', 'card-1')).toBeUndefined();
			// s2 and s3 (newer) should remain
			expect(getSnapshot('proj-1', 'card-2')).toBeDefined();
			expect(getSnapshot('proj-1', 'card-3')).toBeDefined();
		});

		it('evicts oldest snapshots when max-size is exceeded', () => {
			const s1 = registerSnapshot('proj-1', 'card-1', 'img-1:latest', 500);
			const s2 = registerSnapshot('proj-1', 'card-2', 'img-2:latest', 600);
			const s3 = registerSnapshot('proj-1', 'card-3', 'img-3:latest', 400);

			// Make s1 oldest
			s1.createdAt = new Date(Date.now() - 3000);
			s2.createdAt = new Date(Date.now() - 2000);
			s3.createdAt = new Date(Date.now() - 1000);

			// Total = 1500 bytes, cap at 1100 — need to evict 400+ bytes (oldest first)
			const evicted = evictSnapshots(24 * 60 * 60 * 1000, 100, 1100);

			// After removing s1 (500 bytes): 1000 <= 1100, done
			expect(evicted).toBe(1);
			expect(getSnapshotCount()).toBe(2);
			expect(getSnapshot('proj-1', 'card-1')).toBeUndefined();
			expect(getSnapshot('proj-1', 'card-2')).toBeDefined();
			expect(getSnapshot('proj-1', 'card-3')).toBeDefined();
		});

		it('applies TTL eviction before max-count eviction', () => {
			const s1 = registerSnapshot('proj-1', 'card-1', 'img-1:latest');
			const s2 = registerSnapshot('proj-1', 'card-2', 'img-2:latest');
			const s3 = registerSnapshot('proj-1', 'card-3', 'img-3:latest');

			// Expire s1 and s2
			s1.createdAt = new Date(Date.now() - 2000);
			s2.createdAt = new Date(Date.now() - 2000);
			s3.createdAt = new Date();

			// TTL = 1s, maxCount = 2 — TTL should remove s1 and s2 first
			const evicted = evictSnapshots(1000, 2, 10 * 1024 * 1024 * 1024);

			// Both expired, so 2 removed by TTL, count drops to 1 which is under maxCount=2
			expect(evicted).toBe(2);
			expect(getSnapshotCount()).toBe(1);
			expect(getSnapshot('proj-1', 'card-3')).toBeDefined();
		});

		it('does not evict when under all budgets', () => {
			registerSnapshot('proj-1', 'card-1', 'img-1:latest', 100);
			registerSnapshot('proj-1', 'card-2', 'img-2:latest', 200);

			const evicted = evictSnapshots(24 * 60 * 60 * 1000, 10, 10 * 1024 * 1024 * 1024);

			expect(evicted).toBe(0);
			expect(getSnapshotCount()).toBe(2);
		});

		it('handles snapshots with no imageSizeBytes in max-size eviction', () => {
			const s1 = registerSnapshot('proj-1', 'card-1', 'img-1:latest'); // no size
			const s2 = registerSnapshot('proj-1', 'card-2', 'img-2:latest', 500);

			// s1 oldest
			s1.createdAt = new Date(Date.now() - 2000);
			s2.createdAt = new Date(Date.now() - 1000);

			// Total known size = 500 bytes, below the 1000 byte cap
			// Snapshots without size contribute 0 — no eviction needed
			const evicted = evictSnapshots(24 * 60 * 60 * 1000, 100, 1000);

			expect(evicted).toBe(0);
			expect(getSnapshotCount()).toBe(2);
		});

		it('uses routerConfig defaults when no args passed', () => {
			// Register 6 snapshots — over the mocked snapshotMaxCount of 5
			for (let i = 1; i <= 6; i++) {
				const s = registerSnapshot('proj-1', `card-${i}`, `img-${i}:latest`);
				// Age oldest first
				s.createdAt = new Date(Date.now() - (7 - i) * 1000);
			}

			// routerConfig.snapshotMaxCount = 5 (from mock) — evictSnapshots() with no args
			// should use that default
			const evicted = evictSnapshots();

			expect(evicted).toBe(1);
			expect(getSnapshotCount()).toBe(5);
		});
	});
});
