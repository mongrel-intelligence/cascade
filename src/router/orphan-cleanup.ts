/**
 * Orphaned container cleanup for CASCADE worker processes.
 *
 * Self-contained periodic task that scans for containers with cascade.managed=true
 * that are not tracked in the activeWorkers map and are older than workerTimeoutMs.
 */

import Docker from 'dockerode';
import { failOrphanedRunFallback } from '../db/repositories/runsRepository.js';
import { captureException } from '../sentry.js';
import { logger } from '../utils/logging.js';
import { getTrackedContainerIds } from './active-workers.js';
import { routerConfig } from './config.js';

const docker = new Docker();

/**
 * Periodic orphan cleanup timer — scans for containers with cascade.managed=true
 * that are not tracked in activeWorkers map and are older than workerTimeoutMs.
 */
let orphanCleanupTimer: NodeJS.Timeout | null = null;

/**
 * Start periodic orphaned container cleanup.
 * Scans every 5 minutes for containers with cascade.managed=true label
 * that are not in the activeWorkers map and are older than workerTimeoutMs.
 * Stopped containers are logged at warn level with container ID and age.
 */
export function startOrphanCleanup(): void {
	if (orphanCleanupTimer) {
		logger.warn('[WorkerManager] Orphan cleanup already started');
		return;
	}

	const ORPHAN_SCAN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

	orphanCleanupTimer = setInterval(() => {
		scanAndCleanupOrphans().catch((err) => {
			logger.error('[WorkerManager] Error during orphan cleanup scan:', err);
			captureException(err, {
				tags: { source: 'orphan_cleanup_scan' },
				level: 'error',
			});
		});
	}, ORPHAN_SCAN_INTERVAL_MS);

	logger.info('[WorkerManager] Started orphan cleanup scan (every 5 minutes)');
}

/**
 * Stop periodic orphaned container cleanup.
 * Clears the scan timer.
 */
export function stopOrphanCleanup(): void {
	if (orphanCleanupTimer) {
		clearInterval(orphanCleanupTimer);
		orphanCleanupTimer = null;
		logger.info('[WorkerManager] Stopped orphan cleanup scan');
	}
}

/**
 * Scan for orphaned containers and stop them.
 * Containers are considered orphaned if:
 * 1. They have cascade.managed=true label
 * 2. They are NOT in the activeWorkers map (tracked)
 * 3. They are older than workerTimeoutMs (avoid killing recently-spawned workers)
 * @internal Exported for testing
 */
export async function scanAndCleanupOrphans(): Promise<void> {
	try {
		const containers = await docker.listContainers({
			all: false, // Only running containers
			filters: {
				label: ['cascade.managed=true'],
			},
		});

		const trackedIds = getTrackedContainerIds();
		const now = Date.now();
		let stoppedCount = 0;

		for (const containerInfo of containers) {
			const containerId = containerInfo.Id;

			// Check if this container is tracked in activeWorkers
			if (trackedIds.has(containerId)) {
				// Don't touch tracked containers
				continue;
			}

			// Check container age — only stop if older than workerTimeoutMs
			const containerCreatedMs = containerInfo.Created * 1000;
			const ageMs = now - containerCreatedMs;

			if (ageMs < routerConfig.workerTimeoutMs) {
				// Too young — might be a newly-spawned worker not yet registered
				continue;
			}

			// This is an orphan — stop it and remove it.
			// Remove is called unconditionally after stop: for non-snapshot containers
			// (AutoRemove=true) Docker may already have removed them, in which case
			// remove() is a harmless no-op; for snapshot containers (AutoRemove=false)
			// it ensures stopped containers don't accumulate on disk.
			try {
				const container = docker.getContainer(containerId);
				await container.stop({ t: 15 }); // 15 second graceful shutdown
				await container.remove({ force: false }).catch(() => {
					// Container may have been removed by Docker's AutoRemove — not an error
				});

				stoppedCount++;
				const ageMinutes = Math.round(ageMs / 60000);
				logger.warn('[WorkerManager] Stopped and removed orphaned container:', {
					containerId: containerId.slice(0, 12),
					ageMinutes,
				});

				// Update DB run status (fire-and-forget). Containers created before this
				// change won't have labels (projectId = '' → falsy) → skip, harmless.
				const projectId = containerInfo.Labels?.['cascade.project.id'];
				if (projectId) {
					const containerCreatedAt = new Date(containerInfo.Created * 1000);
					const orphanDurationMs = now - containerInfo.Created * 1000;
					// agentType narrows the fallback query when multiple agent types run concurrently
					const orphanAgentType = containerInfo.Labels?.['cascade.agent.type'] || undefined;
					failOrphanedRunFallback(
						projectId,
						orphanAgentType,
						containerCreatedAt,
						'failed',
						'Orphan cleanup: container stopped',
						orphanDurationMs,
					)
						.then((runId) => {
							if (runId)
								logger.info('[WorkerManager] Marked orphaned run as failed after cleanup', {
									containerId: containerId.slice(0, 12),
									runId,
								});
						})
						.catch((err) =>
							logger.error('[WorkerManager] DB update failed after orphan cleanup', {
								containerId: containerId.slice(0, 12),
								error: String(err),
							}),
						);
				}
			} catch (err) {
				// Container might already be stopped — log but continue
				logger.warn('[WorkerManager] Error stopping orphaned container:', {
					containerId: containerId.slice(0, 12),
					error: String(err),
				});
			}
		}

		if (stoppedCount > 0) {
			logger.info('[WorkerManager] Orphan cleanup scan completed:', {
				stoppedCount,
				totalContainers: containers.length,
			});
		}
	} catch (err) {
		logger.error('[WorkerManager] Failed to list containers for orphan cleanup:', err);
		throw err;
	}
}
