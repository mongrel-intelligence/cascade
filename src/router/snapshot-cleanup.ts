/**
 * Periodic snapshot eviction for CASCADE worker snapshots.
 *
 * Runs alongside the existing orphan cleanup loop (orphan-cleanup.ts) and
 * uses the same start/stop lifecycle pattern. On each tick it calls
 * evictSnapshots() to enforce the per-project TTL and global max-count /
 * max-size budget limits.
 *
 * This module owns only the timer — no Docker API usage. The actual eviction
 * logic lives in snapshot-manager.ts.
 */

import { captureException } from '../sentry.js';
import { logger } from '../utils/logging.js';
import { routerConfig } from './config.js';
import { evictSnapshots } from './snapshot-manager.js';

const SNAPSHOT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

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

/**
 * Run a single snapshot eviction sweep using the global config limits.
 * Exposed for testing and for manual invocation.
 * @internal Exported for testing
 */
export async function runSnapshotCleanup(): Promise<void> {
	const evicted = evictSnapshots(
		routerConfig.snapshotDefaultTtlMs,
		routerConfig.snapshotMaxCount,
		routerConfig.snapshotMaxSizeBytes,
	);

	if (evicted > 0) {
		logger.info('[SnapshotCleanup] Snapshot cleanup scan removed entries:', { evicted });
	}
}
