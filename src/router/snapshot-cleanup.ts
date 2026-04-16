/**
 * Periodic snapshot eviction for CASCADE worker snapshots.
 *
 * Runs alongside the existing orphan cleanup loop (orphan-cleanup.ts) and
 * uses the same start/stop lifecycle pattern. On each tick it calls
 * evictSnapshots() to enforce the per-project TTL and global max-count /
 * max-size budget limits, then `docker rmi`s every evicted entry's image.
 *
 * The Docker rmi step is critical: prior to PR #1132 the eviction loop only
 * cleared the in-memory metadata Map and never freed the underlying images,
 * which leaked ~3 GB per work item until the host disk filled.
 */

import Docker from 'dockerode';
import { captureException } from '../sentry.js';
import { logger } from '../utils/logging.js';
import { routerConfig } from './config.js';
import { evictSnapshots, type SnapshotMetadata } from './snapshot-manager.js';

const SNAPSHOT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const docker = new Docker();

/** Periodic snapshot cleanup timer */
let snapshotCleanupTimer: NodeJS.Timeout | null = null;

/**
 * Start periodic snapshot eviction.
 * Runs every 5 minutes and enforces TTL plus global max-count / max-size limits.
 * No-op if already started.
 */
export function startSnapshotCleanup(): void {
	if (snapshotCleanupTimer) {
		logger.warn('[SnapshotCleanup] Snapshot cleanup already started');
		return;
	}

	snapshotCleanupTimer = setInterval(() => {
		runSnapshotCleanup().catch((err) => {
			logger.error('[SnapshotCleanup] Error during snapshot cleanup scan:', err);
			captureException(err, {
				tags: { source: 'snapshot_cleanup_scan' },
				level: 'error',
			});
		});
	}, SNAPSHOT_CLEANUP_INTERVAL_MS);

	logger.info('[SnapshotCleanup] Started snapshot cleanup scan (every 5 minutes)');
}

/**
 * Stop periodic snapshot eviction.
 * Clears the scan timer. No-op if not started.
 */
export function stopSnapshotCleanup(): void {
	if (snapshotCleanupTimer) {
		clearInterval(snapshotCleanupTimer);
		snapshotCleanupTimer = null;
		logger.info('[SnapshotCleanup] Stopped snapshot cleanup scan');
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
 * Remove a snapshot image from Docker. `force: false` so an image still backing
 * a running container is preserved (Docker returns 409). 404 means the image
 * has already been removed by some other path. Both are harmless and silent.
 */
async function removeSnapshotImage(metadata: SnapshotMetadata): Promise<void> {
	try {
		await docker.getImage(metadata.imageName).remove({ force: false });
		logger.info('[SnapshotCleanup] Removed snapshot image:', {
			imageName: metadata.imageName,
		});
	} catch (err: unknown) {
		const status = dockerStatusCode(err);
		if (status === 409) {
			logger.debug('[SnapshotCleanup] Snapshot image in use, deferring:', {
				imageName: metadata.imageName,
			});
			return;
		}
		if (status === 404) {
			logger.debug('[SnapshotCleanup] Snapshot image already gone:', {
				imageName: metadata.imageName,
			});
			return;
		}
		logger.warn('[SnapshotCleanup] Failed to remove snapshot image:', {
			imageName: metadata.imageName,
			error: String(err),
		});
		captureException(err, {
			tags: { source: 'snapshot_image_remove' },
			extra: { imageName: metadata.imageName },
			level: 'warning',
		});
	}
}

/**
 * Run a single snapshot eviction sweep using the global config limits, then
 * `docker rmi` each evicted image.
 *
 * Exposed for testing and for manual invocation (e.g. immediately after
 * startup-sync registers orphan images).
 * @internal Exported for testing
 */
export async function runSnapshotCleanup(): Promise<void> {
	const evicted = evictSnapshots(
		routerConfig.snapshotDefaultTtlMs,
		routerConfig.snapshotMaxCount,
		routerConfig.snapshotMaxSizeBytes,
	);

	if (evicted.length === 0) return;

	await Promise.all(evicted.map(removeSnapshotImage));

	logger.info('[SnapshotCleanup] Cleanup pass complete:', { count: evicted.length });
}
