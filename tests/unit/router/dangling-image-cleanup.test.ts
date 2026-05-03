import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock state — created before vi.mock factories run
// ---------------------------------------------------------------------------

const {
	mockDockerListImages,
	mockDockerGetImage,
	mockImageRemove,
	mockCaptureException,
	mockLogger,
} = vi.hoisted(() => {
	const mockImageRemove = vi.fn().mockResolvedValue(undefined);
	return {
		mockDockerListImages: vi.fn(),
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
	default: vi.fn().mockImplementation(() => ({
		getImage: mockDockerGetImage,
		listImages: mockDockerListImages,
	})),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: mockLogger,
}));

vi.mock('../../../src/sentry.js', () => ({
	captureException: mockCaptureException,
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
	scanAndCleanupDanglingImages,
	startDanglingImageCleanup,
	stopDanglingImageCleanup,
} from '../../../src/router/dangling-image-cleanup.js';

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

function makeImageSummary(id: string, size: number) {
	return { Id: id, Size: size } as never;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('dangling-image-cleanup', () => {
	beforeEach(() => {
		mockDockerListImages.mockReset().mockResolvedValue([]);
		mockImageRemove.mockReset().mockResolvedValue(undefined);
		mockDockerGetImage.mockReset().mockReturnValue({ remove: mockImageRemove });
		mockCaptureException.mockReset();
		mockLogger.info.mockReset();
		mockLogger.warn.mockReset();
		mockLogger.error.mockReset();
		mockLogger.debug.mockReset();
	});

	afterEach(() => {
		stopDanglingImageCleanup();
	});

	describe('scanAndCleanupDanglingImages — scan filter', () => {
		it('lists images with EXACTLY {dangling=true, label=cascade.managed=true} (host-scope safety)', async () => {
			// Regression guard: this filter is the only thing protecting unrelated
			// images on the host (ucho-dev/prod, MySQL, Loki, etc.) from being
			// reaped by a runaway prune. If anyone widens the scope by dropping
			// either clause, this test must fail loudly.
			await scanAndCleanupDanglingImages();

			expect(mockDockerListImages).toHaveBeenCalledTimes(1);
			expect(mockDockerListImages).toHaveBeenCalledWith({
				filters: { dangling: ['true'], label: ['cascade.managed=true'] },
			});
		});

		it('passes the cascade.managed=true label clause (regression guard against scope expansion)', async () => {
			await scanAndCleanupDanglingImages();

			const callArg = mockDockerListImages.mock.calls[0]?.[0] as {
				filters: { dangling?: string[]; label?: string[] };
			};
			expect(callArg.filters.label).toEqual(['cascade.managed=true']);
			expect(callArg.filters.dangling).toEqual(['true']);
		});
	});

	describe('scanAndCleanupDanglingImages — happy path', () => {
		it('removes each returned image with force=false', async () => {
			mockDockerListImages.mockResolvedValue([
				makeImageSummary('sha256:aaa', 5_000_000_000),
				makeImageSummary('sha256:bbb', 4_000_000_000),
			]);

			await scanAndCleanupDanglingImages();

			expect(mockDockerGetImage).toHaveBeenCalledWith('sha256:aaa');
			expect(mockDockerGetImage).toHaveBeenCalledWith('sha256:bbb');
			expect(mockImageRemove).toHaveBeenCalledTimes(2);
			expect(mockImageRemove).toHaveBeenNthCalledWith(1, { force: false });
			expect(mockImageRemove).toHaveBeenNthCalledWith(2, { force: false });
		});

		it('logs the cleanup summary with removedCount and reclaimedBytes', async () => {
			mockDockerListImages.mockResolvedValue([
				makeImageSummary('sha256:aaa', 5_000_000_000),
				makeImageSummary('sha256:bbb', 4_000_000_000),
			]);

			await scanAndCleanupDanglingImages();

			expect(mockLogger.info).toHaveBeenCalledWith(
				'[DanglingImageCleanup] Cleanup pass complete:',
				expect.objectContaining({
					removedCount: 2,
					reclaimedBytes: 9_000_000_000,
				}),
			);
		});

		it('does NOT log a summary when no images were found (zero noise)', async () => {
			mockDockerListImages.mockResolvedValue([]);

			await scanAndCleanupDanglingImages();

			expect(mockLogger.info).not.toHaveBeenCalledWith(
				'[DanglingImageCleanup] Cleanup pass complete:',
				expect.anything(),
			);
		});
	});

	describe('scanAndCleanupDanglingImages — Docker error swallowing', () => {
		it('swallows 409 (image still in use) and continues with the next image', async () => {
			mockDockerListImages.mockResolvedValue([
				makeImageSummary('sha256:in-use', 1_000),
				makeImageSummary('sha256:ok', 2_000),
			]);
			mockImageRemove
				.mockRejectedValueOnce(makeDockerError(409, 'image is being used'))
				.mockResolvedValueOnce(undefined);

			await expect(scanAndCleanupDanglingImages()).resolves.toBeUndefined();
			expect(mockImageRemove).toHaveBeenCalledTimes(2);
			// 409 is debug-logged, not warn — to keep the noise floor low.
			expect(mockLogger.debug).toHaveBeenCalledWith(
				'[DanglingImageCleanup] Dangling image in use, deferring:',
				expect.objectContaining({ imageId: 'sha256:in-use' }),
			);
			expect(mockCaptureException).not.toHaveBeenCalled();
		});

		it('swallows 404 (image already gone) and continues', async () => {
			mockDockerListImages.mockResolvedValue([
				makeImageSummary('sha256:gone', 1_000),
				makeImageSummary('sha256:ok', 2_000),
			]);
			mockImageRemove
				.mockRejectedValueOnce(makeDockerError(404, 'no such image'))
				.mockResolvedValueOnce(undefined);

			await expect(scanAndCleanupDanglingImages()).resolves.toBeUndefined();
			expect(mockImageRemove).toHaveBeenCalledTimes(2);
			expect(mockLogger.debug).toHaveBeenCalledWith(
				'[DanglingImageCleanup] Dangling image already gone:',
				expect.objectContaining({ imageId: 'sha256:gone' }),
			);
			expect(mockCaptureException).not.toHaveBeenCalled();
		});

		it('captures unexpected errors to Sentry under tag dangling_image_remove and continues', async () => {
			mockDockerListImages.mockResolvedValue([
				makeImageSummary('sha256:bad', 1_000),
				makeImageSummary('sha256:ok', 2_000),
			]);
			mockImageRemove
				.mockRejectedValueOnce(makeDockerError(500, 'internal docker error'))
				.mockResolvedValueOnce(undefined);

			await expect(scanAndCleanupDanglingImages()).resolves.toBeUndefined();

			expect(mockLogger.warn).toHaveBeenCalledWith(
				'[DanglingImageCleanup] Failed to remove dangling image:',
				expect.objectContaining({ imageId: 'sha256:bad' }),
			);
			expect(mockCaptureException).toHaveBeenCalledWith(
				expect.any(Error),
				expect.objectContaining({
					tags: expect.objectContaining({ source: 'dangling_image_remove' }),
				}),
			);
			// Loop must continue after the failed image.
			expect(mockImageRemove).toHaveBeenCalledTimes(2);
		});

		it('handles Docker listImages errors by logging at error level', async () => {
			mockDockerListImages.mockRejectedValue(new Error('docker daemon down'));

			await expect(scanAndCleanupDanglingImages()).resolves.toBeUndefined();
			expect(mockLogger.error).toHaveBeenCalledWith(
				'[DanglingImageCleanup] Failed to list dangling images:',
				expect.any(Error),
			);
			expect(mockCaptureException).toHaveBeenCalledWith(
				expect.any(Error),
				expect.objectContaining({
					tags: expect.objectContaining({ source: 'dangling_image_cleanup_scan' }),
				}),
			);
		});
	});

	describe('Dockerfile LABEL contract — static guard', () => {
		// Counterpart to the scan-filter regression guard above. The filter
		// only matches images carrying the `cascade.managed=true` label, and
		// the only way a built image gets that label is via a `LABEL`
		// directive in the Dockerfile. PR #1243 shipped the cleanup loop
		// without this contract — the loop was a no-op for days because no
		// image carried the label. If a new `Dockerfile.<svc>` lands at the
		// repo root without the directive, the cleanup loop silently stops
		// reclaiming that service's dangling rebuilds. This test fails
		// loudly the moment that happens.
		const REPO_ROOT = join(__dirname, '..', '..', '..');
		const dockerfiles = readdirSync(REPO_ROOT)
			.filter((name) => name.startsWith('Dockerfile.'))
			.sort();

		it('finds the expected cascade Dockerfiles at repo root (sanity)', () => {
			// Sanity: if this assertion fails the glob is broken or someone
			// renamed the Dockerfiles, and the per-file assertions below
			// would silently pass on an empty list.
			expect(dockerfiles.length).toBeGreaterThanOrEqual(5);
			expect(dockerfiles).toEqual(
				expect.arrayContaining([
					'Dockerfile.dashboard',
					'Dockerfile.frontend',
					'Dockerfile.router',
					'Dockerfile.selfhosted',
					'Dockerfile.worker',
				]),
			);
		});

		it.each([
			'Dockerfile.router',
			'Dockerfile.worker',
			'Dockerfile.dashboard',
			'Dockerfile.frontend',
			'Dockerfile.selfhosted',
		])('%s declares LABEL cascade.managed=true so dangling rebuilds match the cleanup filter', (filename) => {
			const contents = readFileSync(join(REPO_ROOT, filename), 'utf8');
			// Match `LABEL cascade.managed=true` (with optional quotes
			// around the value). Tolerates `LABEL k=v k2=v2` chains.
			const labelRegex = /^\s*LABEL\b[^\n]*\bcascade\.managed=("?)true\1/im;
			expect(contents).toMatch(labelRegex);
		});
	});

	describe('startDanglingImageCleanup / stopDanglingImageCleanup', () => {
		it('starts a periodic cleanup scan', () => {
			expect(() => startDanglingImageCleanup()).not.toThrow();
		});

		it('logs a startup message naming the scan interval', () => {
			startDanglingImageCleanup();
			expect(mockLogger.info).toHaveBeenCalledWith(
				expect.stringContaining('[DanglingImageCleanup] Started'),
			);
		});

		it('is idempotent on multiple starts — second call warns and creates no second timer', () => {
			startDanglingImageCleanup();
			startDanglingImageCleanup();
			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining('[DanglingImageCleanup] Cleanup already started'),
			);
		});

		it('stop is a no-op when not started', () => {
			expect(() => stopDanglingImageCleanup()).not.toThrow();
		});

		it('allows multiple start/stop cycles', () => {
			expect(() => {
				startDanglingImageCleanup();
				stopDanglingImageCleanup();
				startDanglingImageCleanup();
				stopDanglingImageCleanup();
			}).not.toThrow();
		});
	});
});
