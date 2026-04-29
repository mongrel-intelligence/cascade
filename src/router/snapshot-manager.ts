/**
 * Snapshot metadata manager for CASCADE worker containers.
 *
 * Tracks reusable snapshot metadata keyed by project and work item so the
 * router can make reuse decisions safely. Snapshots allow repeat runs of
 * the same work item to start from a pre-built Docker image instead of the
 * base worker image, reducing setup time.
 *
 * This module is pure state management — no Docker API usage.
 * Docker commit operations are triggered from container-manager.ts.
 *
 * Eviction strategy:
 * - TTL eviction: snapshots older than ttlMs are removed on access (eager)
 *   or during periodic cleanup scans.
 * - Max-count eviction: when the registry exceeds snapshotMaxCount, the oldest
 *   entries are removed first (LRU by createdAt).
 * - Max-size eviction: when the total estimated image size exceeds
 *   snapshotMaxSizeBytes, the oldest entries are removed first.
 */

import { logger } from '../utils/logging.js';
import { routerConfig } from './config.js';

export interface SnapshotMetadata {
	/** Docker image name (e.g., 'cascade-snapshot-proj-1-card-abc:latest') */
	imageName: string;
	/** Project ID this snapshot belongs to */
	projectId: string;
	/** Work item ID this snapshot was built for */
	workItemId: string;
	/** Wall-clock timestamp when the snapshot was created */
	createdAt: Date;
	/** Estimated size of the snapshot image in bytes (optional, used for budget eviction) */
	imageSizeBytes?: number;
}

/** In-memory snapshot registry keyed by `${projectId}:${workItemId}` */
const snapshots = new Map<string, SnapshotMetadata>();

/** Synthetic projectId used for entries discovered on disk at startup. */
const DISCOVERED_PROJECT_ID = '__discovered__';

function snapshotKey(projectId: string, workItemId: string): string {
	return `${projectId}:${workItemId}`;
}

function discoveredKey(imageName: string): string {
	return snapshotKey(DISCOVERED_PROJECT_ID, imageName);
}

/**
 * Register or refresh snapshot metadata for a project+workItem pair.
 * Overwrites any existing entry for the same key.
 *
 * Also drops any "discovered" entry that points to the same image, so the
 * startup-sync orphan tracking doesn't double-count an image that's now
 * being actively managed.
 */
export function registerSnapshot(
	projectId: string,
	workItemId: string,
	imageName: string,
	imageSizeBytes?: number,
): SnapshotMetadata {
	const key = snapshotKey(projectId, workItemId);
	const metadata: SnapshotMetadata = {
		imageName,
		projectId,
		workItemId,
		createdAt: new Date(),
		imageSizeBytes,
	};
	snapshots.set(key, metadata);
	// Drop any orphan-tracking entry for the same image — the real registration
	// supersedes it.
	snapshots.delete(discoveredKey(imageName));
	logger.info('[SnapshotManager] Snapshot registered:', {
		projectId,
		workItemId,
		imageName,
	});
	return metadata;
}

/**
 * Track a snapshot image discovered on disk at startup so the cleanup loop
 * can apply TTL/max-count/max-size limits to it.
 *
 * The (projectId, workItemId) pair cannot be reliably parsed from the
 * sanitised composite image name — sanitisation collapses runs of '-' so
 * `cascade-snapshot-llmist-mng-93:latest` is genuinely ambiguous. We sidestep
 * that by keying discovered entries on the image name itself under a synthetic
 * project (`__discovered__`). Eviction works the same way regardless of key.
 *
 * No-op when an entry already exists for this image, either as a discovered
 * orphan or as a real registration.
 */
export function registerDiscoveredSnapshot(
	imageName: string,
	createdAt: Date,
	imageSizeBytes: number,
): void {
	const key = discoveredKey(imageName);
	if (snapshots.has(key)) return;
	for (const m of snapshots.values()) {
		if (m.imageName === imageName) return;
	}
	snapshots.set(key, {
		imageName,
		projectId: DISCOVERED_PROJECT_ID,
		workItemId: imageName,
		createdAt,
		imageSizeBytes,
	});
	logger.debug('[SnapshotManager] Discovered orphan snapshot tracked:', {
		imageName,
		createdAt: createdAt.toISOString(),
		imageSizeBytes,
	});
}

/**
 * Look up snapshot metadata for a project+workItem pair.
 * Returns undefined if no snapshot exists or if the snapshot has exceeded the
 * effective TTL. Expired entries are removed eagerly.
 *
 * @param ttlMs - Effective TTL in milliseconds. Callers should pass
 *   `projectCfg?.snapshotTtlMs ?? routerConfig.snapshotDefaultTtlMs` so that
 *   per-project TTL overrides are honoured. Defaults to the global
 *   `snapshotDefaultTtlMs` when omitted.
 */
export function getSnapshot(
	projectId: string,
	workItemId: string,
	ttlMs: number = routerConfig.snapshotDefaultTtlMs,
): SnapshotMetadata | undefined {
	const key = snapshotKey(projectId, workItemId);
	const metadata = snapshots.get(key);
	if (!metadata) return undefined;

	const ageMs = Date.now() - metadata.createdAt.getTime();
	if (ageMs > ttlMs) {
		snapshots.delete(key);
		logger.info('[SnapshotManager] Snapshot expired and evicted:', {
			projectId,
			workItemId,
			ageMs,
			ttlMs,
		});
		return undefined;
	}

	return metadata;
}

/**
 * Invalidate (remove) snapshot metadata for a project+workItem pair.
 * Returns the removed metadata so the caller can `docker rmi` the underlying
 * image. Returns undefined when no entry was registered. Removing the in-memory
 * entry without removing the image would orphan the image (the periodic cleanup
 * loop iterates registry entries only) — callers MUST act on the returned
 * metadata. See snapshot-cleanup.invalidateAndRemoveSnapshot for the canonical
 * caller.
 */
export function invalidateSnapshot(
	projectId: string,
	workItemId: string,
): SnapshotMetadata | undefined {
	const key = snapshotKey(projectId, workItemId);
	const removed = snapshots.get(key);
	snapshots.delete(key);
	if (removed) {
		logger.info('[SnapshotManager] Snapshot invalidated:', {
			projectId,
			workItemId,
		});
	}
	return removed;
}

/**
 * Return the number of currently registered snapshots.
 * Primarily useful for tests and monitoring.
 */
export function getSnapshotCount(): number {
	return snapshots.size;
}

/**
 * Evict expired and over-budget snapshots from the in-memory registry.
 *
 * Eviction order:
 * 1. TTL: remove all entries older than snapshotDefaultTtlMs.
 * 2. Max-count: if still over-budget, remove oldest entries until at or below
 *    snapshotMaxCount.
 * 3. Max-size: if still over-budget, remove oldest entries until estimated
 *    total size is at or below snapshotMaxSizeBytes.
 *
 * Returns the metadata of every evicted entry so the caller can do the
 * matching `docker rmi`. Removing the in-memory entry without removing the
 * underlying image (the prior behaviour of this function) is the leak that
 * filled the dev disk to 100% — callers MUST act on the returned list.
 */
export function evictSnapshots(
	ttlMs: number = routerConfig.snapshotDefaultTtlMs,
	maxCount: number = routerConfig.snapshotMaxCount,
	maxSizeBytes: number = routerConfig.snapshotMaxSizeBytes,
): SnapshotMetadata[] {
	const evicted: SnapshotMetadata[] = [];
	const now = Date.now();

	// Phase 1: TTL eviction — remove all expired entries
	for (const [key, metadata] of snapshots) {
		const ageMs = now - metadata.createdAt.getTime();
		if (ageMs > ttlMs) {
			snapshots.delete(key);
			evicted.push(metadata);
			logger.info('[SnapshotManager] Evicted expired snapshot:', {
				projectId: metadata.projectId,
				workItemId: metadata.workItemId,
				ageMs,
				ttlMs,
			});
		}
	}

	// Phase 2: Max-count eviction — remove oldest entries if over budget
	if (snapshots.size > maxCount) {
		const sorted = Array.from(snapshots.entries()).sort(
			([, a], [, b]) => a.createdAt.getTime() - b.createdAt.getTime(),
		);
		const toRemove = snapshots.size - maxCount;
		for (let i = 0; i < toRemove; i++) {
			const [key, metadata] = sorted[i];
			snapshots.delete(key);
			evicted.push(metadata);
			logger.info('[SnapshotManager] Evicted snapshot (over max-count):', {
				projectId: metadata.projectId,
				workItemId: metadata.workItemId,
				snapshotCount: snapshots.size + (toRemove - i),
				maxCount,
			});
		}
	}

	// Phase 3: Max-size eviction — remove oldest entries if over total size budget
	const totalSizeBytes = Array.from(snapshots.values()).reduce(
		(sum, m) => sum + (m.imageSizeBytes ?? 0),
		0,
	);
	if (totalSizeBytes > maxSizeBytes) {
		const sorted = Array.from(snapshots.entries()).sort(
			([, a], [, b]) => a.createdAt.getTime() - b.createdAt.getTime(),
		);
		let runningSize = totalSizeBytes;
		for (const [key, metadata] of sorted) {
			if (runningSize <= maxSizeBytes) break;
			snapshots.delete(key);
			evicted.push(metadata);
			runningSize -= metadata.imageSizeBytes ?? 0;
			logger.info('[SnapshotManager] Evicted snapshot (over max-size):', {
				projectId: metadata.projectId,
				workItemId: metadata.workItemId,
				imageSizeBytes: metadata.imageSizeBytes,
				runningSize,
				maxSizeBytes,
			});
		}
	}

	if (evicted.length > 0) {
		logger.info('[SnapshotManager] Eviction sweep complete:', {
			evicted: evicted.length,
			remaining: snapshots.size,
		});
	}

	return evicted;
}

/**
 * Clear all snapshot metadata.
 * Intended for use in tests and clean-shutdown scenarios.
 * @internal Visible for testing
 */
export function _clearAllSnapshots(): void {
	snapshots.clear();
}
