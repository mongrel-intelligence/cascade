/**
 * Worker spawn settings for CASCADE worker containers.
 *
 * Resolves Docker-free configuration decisions used by container-manager.ts:
 * effective worker image, snapshot reuse, router timeout, and safe container
 * names. This module intentionally has no Docker dependency.
 */

import { logger } from '../utils/logging.js';
import { loadProjectConfig, routerConfig } from './config.js';
import { getSnapshot } from './snapshot-manager.js';

/** Buffer added on top of the in-container watchdog so the router kill is always a backstop. */
export const ROUTER_KILL_BUFFER_MS = 2 * 60 * 1000;

export interface SpawnSettings {
	snapshotEnabled: boolean;
	workerImage: string;
	containerTimeoutMs: number;
	snapshotTtlMs: number;
}

/**
 * Build the Docker container name for a worker job.
 *
 * Docker container names accept only `[a-zA-Z0-9][a-zA-Z0-9_.-]`. BullMQ
 * coalesced jobs can include colons (`coalesce:project:item`), so disallowed
 * chars are replaced with underscores while the original jobId remains intact
 * for logs and dedup keys.
 */
export function buildWorkerContainerName(jobId: string): string {
	const containerSafeJobId = jobId.replace(/[^a-zA-Z0-9_.-]/g, '_');
	return `cascade-worker-${containerSafeJobId}`;
}

/**
 * Resolve per-project spawn settings (snapshot flag, image, timeout).
 * Centralises all loadProjectConfig() calls so spawnWorker stays simple.
 */
export async function resolveSpawnSettings(
	projectId: string | null,
	workItemId: string | undefined,
	jobId: string,
): Promise<SpawnSettings> {
	let snapshotEnabled = false;
	let workerImage = routerConfig.workerImage;
	let containerTimeoutMs = routerConfig.workerTimeoutMs;
	let snapshotTtlMs = routerConfig.snapshotDefaultTtlMs;

	if (!projectId) return { snapshotEnabled, workerImage, containerTimeoutMs, snapshotTtlMs };

	const { fullProjects } = await loadProjectConfig();
	const projectCfg = fullProjects.find((p) => p.id === projectId);

	// Project-level snapshotEnabled overrides the global default.
	snapshotEnabled = projectCfg?.snapshotEnabled ?? routerConfig.snapshotEnabled;

	// Per-project TTL overrides the global default.
	snapshotTtlMs = projectCfg?.snapshotTtlMs ?? routerConfig.snapshotDefaultTtlMs;

	if (snapshotEnabled && workItemId) {
		const snapshot = getSnapshot(projectId, workItemId, snapshotTtlMs);
		if (snapshot) {
			logger.info('[WorkerManager] Snapshot hit — using snapshot image:', {
				jobId,
				imageName: snapshot.imageName,
				projectId,
				workItemId,
			});
			workerImage = snapshot.imageName;
		} else {
			logger.info('[WorkerManager] Snapshot miss — using base worker image:', {
				jobId,
				projectId,
				workItemId,
			});
		}
	}

	// Use project's watchdogTimeoutMs + buffer if available, falling back to the
	// global workerTimeoutMs. The in-container watchdog fires first; router kill
	// is a backup.
	if (projectCfg?.watchdogTimeoutMs) {
		containerTimeoutMs = projectCfg.watchdogTimeoutMs + ROUTER_KILL_BUFFER_MS;
	}

	// Trace-log the actual values that govern this worker's lifetime so a
	// post-mortem can confirm whether the project's watchdogTimeoutMs override
	// took effect or the global default leaked through.
	logger.info('[WorkerManager] Resolved spawn settings:', {
		jobId,
		projectId,
		workItemId,
		workerImage,
		snapshotEnabled,
		containerTimeoutMs,
		containerTimeoutMinutes: Math.round(containerTimeoutMs / 60_000),
		projectWatchdogTimeoutMs: projectCfg?.watchdogTimeoutMs ?? null,
		globalWorkerTimeoutMs: routerConfig.workerTimeoutMs,
	});

	return { snapshotEnabled, workerImage, containerTimeoutMs, snapshotTtlMs };
}
