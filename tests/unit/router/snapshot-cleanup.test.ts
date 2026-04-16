import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock state
// ---------------------------------------------------------------------------

const {
	mockEvictSnapshots,
	mockDockerGetImage,
	mockImageRemove,
	mockCaptureException,
	mockLogger,
} = vi.hoisted(() => {
	const mockImageRemove = vi.fn().mockResolvedValue(undefined);
	return {
		mockEvictSnapshots: vi.fn().mockReturnValue([]),
		mockDockerGetImage: vi.fn().mockReturnValue({ remove: mockImageRemove }),
		mockImageRemove,
		mockCaptureException: vi.fn(),
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
	default: vi.fn().mockImplementation(() => ({ getImage: mockDockerGetImage })),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: mockLogger,
}));

vi.mock('../../../src/sentry.js', () => ({
	captureException: mockCaptureException,
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
// Helpers
// ---------------------------------------------------------------------------

interface DockerErrorShape {
	statusCode?: number;
	message?: string;
}

function makeDockerError(statusCode: number, message: string): Error & DockerErrorShape {
	const err = new Error(message) as Error & DockerErrorShape;
	err.statusCode = statusCode;
	return err;
}

function makeMetadata(overrides: Partial<{ imageName: string; size: number }> = {}) {
	return {
		imageName: overrides.imageName ?? 'cascade-snapshot-proj-card:latest',
		projectId: 'proj',
		workItemId: 'card',
		createdAt: new Date(),
		imageSizeBytes: overrides.size ?? 100,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('snapshot-cleanup', () => {
	beforeEach(() => {
		mockEvictSnapshots.mockClear();
		mockDockerGetImage.mockClear();
		mockImageRemove.mockReset();
		mockImageRemove.mockResolvedValue(undefined);
		mockCaptureException.mockClear();
		mockLogger.info.mockClear();
		mockLogger.warn.mockClear();
		mockLogger.error.mockClear();
		mockLogger.debug.mockClear();
		mockEvictSnapshots.mockReturnValue([]);
	});

	afterEach(() => {
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
	// runSnapshotCleanup — invocation
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

		it('resolves without throwing when evictSnapshots returns no entries', async () => {
			mockEvictSnapshots.mockReturnValue([]);
			await expect(runSnapshotCleanup()).resolves.toBeUndefined();
			expect(mockDockerGetImage).not.toHaveBeenCalled();
		});
	});

	// -------------------------------------------------------------------------
	// runSnapshotCleanup — Docker rmi behavior
	// -------------------------------------------------------------------------

	describe('runSnapshotCleanup — actually removes Docker images', () => {
		it('calls docker.getImage().remove({ force: false }) for each evicted entry', async () => {
			mockEvictSnapshots.mockReturnValue([
				makeMetadata({ imageName: 'cascade-snapshot-a:latest' }),
				makeMetadata({ imageName: 'cascade-snapshot-b:latest' }),
			]);

			await runSnapshotCleanup();

			expect(mockDockerGetImage).toHaveBeenCalledWith('cascade-snapshot-a:latest');
			expect(mockDockerGetImage).toHaveBeenCalledWith('cascade-snapshot-b:latest');
			expect(mockImageRemove).toHaveBeenCalledTimes(2);
			expect(mockImageRemove).toHaveBeenCalledWith({ force: false });
		});

		it('swallows 409 (image in use) without warning or sentry capture', async () => {
			mockEvictSnapshots.mockReturnValue([makeMetadata()]);
			mockImageRemove.mockRejectedValueOnce(makeDockerError(409, 'image is in use by container'));

			await expect(runSnapshotCleanup()).resolves.toBeUndefined();

			expect(mockLogger.warn).not.toHaveBeenCalled();
			expect(mockCaptureException).not.toHaveBeenCalled();
		});

		it('swallows 404 (image already gone) without warning or sentry capture', async () => {
			mockEvictSnapshots.mockReturnValue([makeMetadata()]);
			mockImageRemove.mockRejectedValueOnce(makeDockerError(404, 'no such image'));

			await expect(runSnapshotCleanup()).resolves.toBeUndefined();

			expect(mockLogger.warn).not.toHaveBeenCalled();
			expect(mockCaptureException).not.toHaveBeenCalled();
		});

		it('logs a warning and captures Sentry exception on unexpected error', async () => {
			mockEvictSnapshots.mockReturnValue([makeMetadata()]);
			mockImageRemove.mockRejectedValueOnce(new Error('docker daemon down'));

			await expect(runSnapshotCleanup()).resolves.toBeUndefined();

			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining('Failed to remove snapshot image'),
				expect.objectContaining({ imageName: expect.any(String) }),
			);
			expect(mockCaptureException).toHaveBeenCalled();
		});

		it('continues processing remaining entries when one removal fails', async () => {
			mockEvictSnapshots.mockReturnValue([
				makeMetadata({ imageName: 'a:latest' }),
				makeMetadata({ imageName: 'b:latest' }),
				makeMetadata({ imageName: 'c:latest' }),
			]);
			mockImageRemove
				.mockResolvedValueOnce(undefined)
				.mockRejectedValueOnce(new Error('boom'))
				.mockResolvedValueOnce(undefined);

			await runSnapshotCleanup();

			expect(mockImageRemove).toHaveBeenCalledTimes(3);
		});
	});
});
