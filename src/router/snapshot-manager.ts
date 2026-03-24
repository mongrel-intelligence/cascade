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
}

/** In-memory snapshot registry keyed by `${projectId}:${workItemId}` */
const snapshots = new Map<string, SnapshotMetadata>();

function snapshotKey(projectId: string, workItemId: string): string {
	return `${projectId}:${workItemId}`;
}

/**
 * Register or refresh snapshot metadata for a project+workItem pair.
 * Overwrites any existing entry for the same key.
 */
export function registerSnapshot(
	projectId: string,
	workItemId: string,
	imageName: string,
): SnapshotMetadata {
	const key = snapshotKey(projectId, workItemId);
	const metadata: SnapshotMetadata = {
		imageName,
		projectId,
		workItemId,
		createdAt: new Date(),
	};
	snapshots.set(key, metadata);
	logger.info('[SnapshotManager] Snapshot registered:', {
		projectId,
		workItemId,
		imageName,
	});
	return metadata;
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
 * Safe to call even if no snapshot exists.
 */
export function invalidateSnapshot(projectId: string, workItemId: string): void {
	const key = snapshotKey(projectId, workItemId);
	const hadEntry = snapshots.delete(key);
	if (hadEntry) {
		logger.info('[SnapshotManager] Snapshot invalidated:', {
			projectId,
			workItemId,
		});
	}
}

/**
 * Return the number of currently registered snapshots.
 * Primarily useful for tests and monitoring.
 */
export function getSnapshotCount(): number {
	return snapshots.size;
}

/**
 * Clear all snapshot metadata.
 * Intended for use in tests and clean-shutdown scenarios.
 * @internal Visible for testing
 */
export function _clearAllSnapshots(): void {
	snapshots.clear();
}
