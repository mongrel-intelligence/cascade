/**
 * Periodic dangling-image cleanup for cascade-managed Docker images.
 *
 * Closes the leak class where `commitContainerToSnapshot` re-tags the
 * `cascade-snapshot-<proj>-<workitem>:latest` slot for repeated runs of the
 * same work item: the previous image's digest becomes dangling (untagged)
 * and is dropped from the in-memory snapshot registry, so the registry-driven
 * `runSnapshotCleanup` (`snapshot-cleanup.ts`) never sees it again. Without
 * this loop, those orphaned digests accumulate at ~5 GB each. Production was
 * measured at 102 GB reclaimable across 136 dangling images on 2026-05-01.
 *
 * Safety: the scan filter is `dangling=true AND label=cascade.managed=true`,
 * AND-ed by Docker's filter API. The label clause is the only thing
 * protecting unrelated host workloads (ucho-dev/prod, MySQL, Loki, etc.)
 * from being reaped — see the regression test of the same name in
 * `tests/unit/router/dangling-image-cleanup.test.ts`. Never widen the scope.
 *
 * The label is applied by the cascade Dockerfiles themselves (every
 * `Dockerfile.<svc>` at repo root carries `LABEL cascade.managed=true` in
 * its production stage). PR #1243 originally shipped this loop without that
 * Dockerfile contract — the loop was a no-op for days because no built
 * image carried the label, and dangling rebuilds accumulated unchecked.
 * The same regression test pins both halves of the contract: the filter
 * shape AND the per-Dockerfile LABEL directive.
 *
 * The CONTAINER label of the same name (`cascade.managed=true`, set in
 * `container-manager.ts` on every `docker run`) is a separate surface used
 * by `orphan-cleanup.ts` to scope container reaping. It does not propagate
 * to images; the Dockerfile LABEL is the only path to image-level matching.
 *
 * The 5-min snapshot eviction loop and the 5-min orphan-container cleanup
 * loop are unaffected; this loop runs at 30 min because dangling
 * accumulation is gradual and `force: false` rmi is cheap.
 */

import Docker from 'dockerode';
import { captureException } from '../sentry.js';
import { logger } from '../utils/logging.js';

const docker = new Docker();

const DANGLING_CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

let danglingCleanupTimer: NodeJS.Timeout | null = null;

/**
 * Start the periodic dangling-image cleanup scan.
 * No-op + warn on double-start. Mirrors `startOrphanCleanup`.
 */
export function startDanglingImageCleanup(): void {
	if (danglingCleanupTimer) {
		logger.warn('[DanglingImageCleanup] Cleanup already started');
		return;
	}

	danglingCleanupTimer = setInterval(() => {
		scanAndCleanupDanglingImages().catch((err) => {
			logger.error('[DanglingImageCleanup] Error during cleanup scan:', err);
			captureException(err, {
				tags: { source: 'dangling_image_cleanup_scan' },
				level: 'error',
			});
		});
	}, DANGLING_CLEANUP_INTERVAL_MS);

	logger.info('[DanglingImageCleanup] Started cleanup scan (every 30 minutes)');
}

/** Stop the periodic dangling-image cleanup scan. No-op when not started. */
export function stopDanglingImageCleanup(): void {
	if (danglingCleanupTimer) {
		clearInterval(danglingCleanupTimer);
		danglingCleanupTimer = null;
		logger.info('[DanglingImageCleanup] Stopped cleanup scan');
	}
}

interface DockerErrorShape {
	statusCode?: number;
}

function dockerStatusCode(err: unknown): number | undefined {
	if (err && typeof err === 'object' && 'statusCode' in err) {
		const code = (err as DockerErrorShape).statusCode;
		return typeof code === 'number' ? code : undefined;
	}
	return undefined;
}

/**
 * Scan for dangling cascade-managed images and remove them.
 *
 * Filter is locked to `dangling=true AND label=cascade.managed=true` —
 * widening this is a regression covered by the test of the same name.
 *
 * Per-image error handling mirrors `removeSnapshotImage` in
 * `snapshot-cleanup.ts:80-110`: 409 (in use) and 404 (already gone) are
 * silently swallowed; any other error is logged at warn and Sentry-captured
 * under tag `dangling_image_remove`. The loop continues regardless.
 *
 * Failures of `listImages` itself are logged at error and Sentry-captured
 * under tag `dangling_image_cleanup_scan`. The function never throws.
 *
 * @internal Exported for testing.
 */
export async function scanAndCleanupDanglingImages(): Promise<void> {
	let images: Array<{ Id: string; Size: number }>;
	try {
		images = (await docker.listImages({
			filters: { dangling: ['true'], label: ['cascade.managed=true'] },
		})) as Array<{ Id: string; Size: number }>;
	} catch (err) {
		logger.error('[DanglingImageCleanup] Failed to list dangling images:', err);
		captureException(err, {
			tags: { source: 'dangling_image_cleanup_scan' },
			level: 'error',
		});
		return;
	}

	if (images.length === 0) return;

	let removedCount = 0;
	let reclaimedBytes = 0;

	for (const img of images) {
		try {
			await docker.getImage(img.Id).remove({ force: false });
			removedCount += 1;
			reclaimedBytes += img.Size;
		} catch (err: unknown) {
			const status = dockerStatusCode(err);
			if (status === 409) {
				logger.debug('[DanglingImageCleanup] Dangling image in use, deferring:', {
					imageId: img.Id,
				});
				continue;
			}
			if (status === 404) {
				logger.debug('[DanglingImageCleanup] Dangling image already gone:', {
					imageId: img.Id,
				});
				continue;
			}
			logger.warn('[DanglingImageCleanup] Failed to remove dangling image:', {
				imageId: img.Id,
				error: String(err),
			});
			captureException(err, {
				tags: { source: 'dangling_image_remove' },
				extra: { imageId: img.Id },
				level: 'warning',
			});
		}
	}

	if (removedCount > 0) {
		logger.info('[DanglingImageCleanup] Cleanup pass complete:', {
			removedCount,
			reclaimedBytes,
		});
	}
}
