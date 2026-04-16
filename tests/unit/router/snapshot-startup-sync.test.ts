/**
 * Verifies that the router can recover from restart amnesia: on startup,
 * any `cascade-snapshot-*` images already on disk get registered in the
 * in-memory map (with their actual creation time + size) so the next
 * eviction sweep can apply TTL/max-count/max-size limits to them.
 *
 * Without this, snapshot images for work items that never re-run pile up
 * forever — exactly the leak that filled the dev disk to 100% (40 GB of
 * orphan llmist snapshots dating back 3 weeks).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock state
// ---------------------------------------------------------------------------

const {
	mockListImages,
	mockDockerGetImage,
	mockRegisterDiscoveredSnapshot,
	mockRunSnapshotCleanup,
	mockLogger,
} = vi.hoisted(() => {
	const mockImageRemove = vi.fn().mockResolvedValue(undefined);
	return {
		mockListImages: vi.fn().mockResolvedValue([]),
		mockDockerGetImage: vi.fn().mockReturnValue({ remove: mockImageRemove }),
		mockRegisterDiscoveredSnapshot: vi.fn(),
		mockRunSnapshotCleanup: vi.fn().mockResolvedValue(undefined),
		mockLogger: {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn(),
		},
	};
});

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('dockerode', () => ({
	default: vi.fn().mockImplementation(() => ({
		listImages: mockListImages,
		getImage: mockDockerGetImage,
	})),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: mockLogger,
}));

vi.mock('../../../src/sentry.js', () => ({
	captureException: vi.fn(),
}));

vi.mock('../../../src/router/snapshot-manager.js', () => ({
	registerDiscoveredSnapshot: (...args: unknown[]) => mockRegisterDiscoveredSnapshot(...args),
}));

vi.mock('../../../src/router/snapshot-cleanup.js', () => ({
	runSnapshotCleanup: () => mockRunSnapshotCleanup(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { syncSnapshotsFromDocker } from '../../../src/router/snapshot-startup-sync.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('snapshot-startup-sync', () => {
	beforeEach(() => {
		mockListImages.mockReset();
		mockListImages.mockResolvedValue([]);
		mockRegisterDiscoveredSnapshot.mockClear();
		mockRunSnapshotCleanup.mockClear();
		mockLogger.info.mockClear();
		mockLogger.warn.mockClear();
		mockLogger.error.mockClear();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('registers every cascade-snapshot-* image found on disk with its actual creation time + size', async () => {
		const t1 = 1700000000;
		const t2 = 1700001000;
		mockListImages.mockResolvedValueOnce([
			{
				RepoTags: ['cascade-snapshot-llmist-mng-93:latest'],
				Created: t1,
				Size: 3_000_000_000,
			},
			{
				RepoTags: ['cascade-snapshot-llmist-mng-94:latest'],
				Created: t2,
				Size: 2_500_000_000,
			},
			// Unrelated images are ignored.
			{ RepoTags: ['cascade-router:dev'], Created: t1, Size: 200_000_000 },
			{ RepoTags: ['postgres:16-alpine'], Created: t1, Size: 100_000_000 },
		]);

		await syncSnapshotsFromDocker();

		expect(mockRegisterDiscoveredSnapshot).toHaveBeenCalledTimes(2);
		expect(mockRegisterDiscoveredSnapshot).toHaveBeenCalledWith(
			'cascade-snapshot-llmist-mng-93:latest',
			new Date(t1 * 1000),
			3_000_000_000,
		);
		expect(mockRegisterDiscoveredSnapshot).toHaveBeenCalledWith(
			'cascade-snapshot-llmist-mng-94:latest',
			new Date(t2 * 1000),
			2_500_000_000,
		);
	});

	it('runs the cleanup sweep immediately after registration so TTL applies to discovered images', async () => {
		mockListImages.mockResolvedValueOnce([
			{
				RepoTags: ['cascade-snapshot-old:latest'],
				Created: 1700000000,
				Size: 1_000_000_000,
			},
		]);

		await syncSnapshotsFromDocker();

		expect(mockRunSnapshotCleanup).toHaveBeenCalledTimes(1);
		// And the order matters: register BEFORE cleanup
		const registerCallOrder = mockRegisterDiscoveredSnapshot.mock.invocationCallOrder[0];
		const cleanupCallOrder = mockRunSnapshotCleanup.mock.invocationCallOrder[0];
		expect(registerCallOrder).toBeLessThan(cleanupCallOrder);
	});

	it('handles images with multiple repo tags (registers each cascade-snapshot tag)', async () => {
		mockListImages.mockResolvedValueOnce([
			{
				RepoTags: ['cascade-snapshot-a:latest', 'cascade-snapshot-a:v1', 'random:tag'],
				Created: 1700000000,
				Size: 500_000_000,
			},
		]);

		await syncSnapshotsFromDocker();

		// Both cascade-snapshot tags registered; random:tag ignored.
		expect(mockRegisterDiscoveredSnapshot).toHaveBeenCalledTimes(2);
	});

	it('does not throw if Docker listImages itself fails (best-effort startup)', async () => {
		mockListImages.mockRejectedValueOnce(new Error('docker daemon unreachable'));

		await expect(syncSnapshotsFromDocker()).resolves.toBeUndefined();
		expect(mockLogger.warn).toHaveBeenCalledWith(
			expect.stringContaining('Failed to sync snapshots from Docker'),
			expect.objectContaining({ error: expect.any(String) }),
		);
		// Cleanup loop still runs against whatever's already in the registry.
		expect(mockRunSnapshotCleanup).toHaveBeenCalledTimes(1);
	});

	it('is a no-op when no cascade-snapshot images exist', async () => {
		mockListImages.mockResolvedValueOnce([
			{ RepoTags: ['cascade-router:dev'], Created: 1700000000, Size: 200_000_000 },
		]);

		await syncSnapshotsFromDocker();

		expect(mockRegisterDiscoveredSnapshot).not.toHaveBeenCalled();
		// Cleanup still runs (idempotent, harmless).
		expect(mockRunSnapshotCleanup).toHaveBeenCalledTimes(1);
	});

	it('handles images with null RepoTags gracefully', async () => {
		mockListImages.mockResolvedValueOnce([
			{ RepoTags: null, Created: 1700000000, Size: 100 },
			{ RepoTags: undefined, Created: 1700000001, Size: 100 },
		]);

		await expect(syncSnapshotsFromDocker()).resolves.toBeUndefined();
		expect(mockRegisterDiscoveredSnapshot).not.toHaveBeenCalled();
	});
});
