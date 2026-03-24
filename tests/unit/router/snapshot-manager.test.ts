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
});
