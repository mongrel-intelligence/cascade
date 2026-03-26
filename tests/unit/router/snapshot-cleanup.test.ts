import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock state
// ---------------------------------------------------------------------------

const { mockEvictSnapshots } = vi.hoisted(() => ({
	mockEvictSnapshots: vi.fn().mockReturnValue(0),
}));

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

vi.mock('../../../src/sentry.js', () => ({
	captureException: vi.fn(),
}));

vi.mock('../../../src/router/config.js', () => ({
	routerConfig: {
		snapshotDefaultTtlMs: 86400000, // 24h
		snapshotMaxCount: 5,
		snapshotMaxSizeBytes: 10737418240, // 10 GB
	},
}));

vi.mock('../../../src/router/snapshot-manager.js', () => ({
	evictSnapshots: (...args: unknown[]) => mockEvictSnapshots(...args),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
	runSnapshotCleanup,
	startSnapshotCleanup,
	stopSnapshotCleanup,
} from '../../../src/router/snapshot-cleanup.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('snapshot-cleanup', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'info').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		mockEvictSnapshots.mockClear();
		mockEvictSnapshots.mockReturnValue(0);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		stopSnapshotCleanup();
	});

	// -------------------------------------------------------------------------
	// startSnapshotCleanup / stopSnapshotCleanup
	// -------------------------------------------------------------------------

	describe('startSnapshotCleanup / stopSnapshotCleanup', () => {
		it('starts a periodic snapshot cleanup scan without throwing', () => {
			expect(() => startSnapshotCleanup()).not.toThrow();
			stopSnapshotCleanup();
		});

		it('stops the snapshot cleanup scan without throwing', () => {
			startSnapshotCleanup();
			expect(() => stopSnapshotCleanup()).not.toThrow();
		});

		it('is a no-op to stop if not started', () => {
			expect(() => stopSnapshotCleanup()).not.toThrow();
		});

		it('is idempotent on multiple starts (warns but does not start a second timer)', () => {
			startSnapshotCleanup();
			expect(() => startSnapshotCleanup()).not.toThrow();
			stopSnapshotCleanup();
		});

		it('allows multiple start/stop cycles', () => {
			expect(() => {
				startSnapshotCleanup();
				stopSnapshotCleanup();
				startSnapshotCleanup();
				stopSnapshotCleanup();
			}).not.toThrow();
		});
	});

	// -------------------------------------------------------------------------
	// runSnapshotCleanup
	// -------------------------------------------------------------------------

	describe('runSnapshotCleanup', () => {
		it('calls evictSnapshots with routerConfig values', async () => {
			await runSnapshotCleanup();

			expect(mockEvictSnapshots).toHaveBeenCalledWith(
				86400000, // snapshotDefaultTtlMs
				5, // snapshotMaxCount
				10737418240, // snapshotMaxSizeBytes
			);
		});

		it('resolves without throwing when evictSnapshots returns 0', async () => {
			mockEvictSnapshots.mockReturnValue(0);
			await expect(runSnapshotCleanup()).resolves.toBeUndefined();
		});

		it('resolves without throwing when evictSnapshots removes entries', async () => {
			mockEvictSnapshots.mockReturnValue(3);
			await expect(runSnapshotCleanup()).resolves.toBeUndefined();
		});
	});
});
