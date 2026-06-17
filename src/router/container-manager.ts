/**
 * Docker container lifecycle management for CASCADE worker processes.
 *
 * Handles spawn orchestration for worker containers.
 * Each BullMQ job gets its own isolated Docker container.
 *
 * State management, env building, and orphan cleanup are in dedicated modules:
 * - active-workers.ts           — ActiveWorker state tracking
 * - worker-env.ts               — Job data parsing + env building
 * - orphan-cleanup.ts           — Periodic orphan container cleanup
 * - snapshot-manager.ts         — Snapshot metadata registry
 * - worker-snapshots.ts         — Docker snapshot commit/remove mechanics
 * - worker-container-launcher.ts — Docker create/start/wait wiring
 */

import type { Job } from 'bullmq';
import { captureException } from '../sentry.js';
import { logger } from '../utils/logging.js';
import { activeWorkers } from './active-workers.js';
import { clearAllAgentTypeLocks } from './agent-type-lock.js';
import { routerConfig } from './config.js';
import { stopOrphanCleanup } from './orphan-cleanup.js';
import type { CascadeJob } from './queue.js';
import { invalidateSnapshot } from './snapshot-manager.js';
import { clearAllWorkItemLocks } from './work-item-lock.js';
import {
	launchWorkerContainer,
	type WorkerContainerLaunchConfig,
} from './worker-container-launcher.js';
import {
	buildWorkerEnvWithProjectId,
	extractAgentType,
	extractProjectIdFromJob,
	extractWorkItemId,
} from './worker-env.js';
import { isImageNotFoundError, pullImageOnce } from './worker-snapshots.js';
import { buildWorkerContainerName, resolveSpawnSettings } from './worker-spawn-settings.js';

// Re-export from sub-modules so existing callers importing from container-manager.ts
// continue to work without changes.
export type { ActiveWorker } from './active-workers.js';
export {
	cleanupWorker,
	getActiveWorkerCount,
	getActiveWorkers,
} from './active-workers.js';
export {
	scanAndCleanupOrphans,
	startOrphanCleanup,
	stopOrphanCleanup,
} from './orphan-cleanup.js';
export {
	getSnapshot,
	invalidateSnapshot,
	registerSnapshot,
} from './snapshot-manager.js';
export {
	launchWorkerContainer,
	type WorkerContainerLaunchConfig,
	type WorkerContainerLaunchContext,
	type WorkerContainerLauncherDependencies,
} from './worker-container-launcher.js';
export {
	buildWorkerEnv,
	extractProjectIdFromJob,
} from './worker-env.js';
export { handleWorkerExit, inspectExitedContainer } from './worker-exit-handler.js';
export {
	buildWorkerSnapshotImageName,
	commitWorkerSnapshot,
	isImageNotFoundError,
	removeWorkerContainerBestEffort,
} from './worker-snapshots.js';
export {
	buildWorkerContainerName,
	ROUTER_KILL_BUFFER_MS,
	resolveSpawnSettings,
} from './worker-spawn-settings.js';
export { killWorker } from './worker-timeouts.js';

async function launchConfiguredWorkerContainer(
	job: Job<CascadeJob>,
	jobId: string,
	containerName: string,
	projectId: string | null,
	workItemId: string | undefined,
	agentType: string | undefined,
	config: WorkerContainerLaunchConfig,
): Promise<void> {
	await launchWorkerContainer(
		{
			job,
			jobId,
			containerName,
			projectId,
			workItemId,
			agentType,
		},
		config,
	);
}

/**
 * Launch a worker container; if the **base** image is missing, pull it once and
 * retry. Snapshot-image 404s propagate so the snapshot fallback path in
 * `spawnWorker` still fires — snapshot images are local commits, not in any
 * registry, so pulling them never helps.
 *
 * Closes the 2026-06-15 outage class where a host-side prune of
 * `cascade-worker:latest` produced silent terminal `UnrecoverableError`s for
 * every spawn — see the post-mortem in `docs/specs/` and the dispatch-error
 * classifier comment that already promised this behaviour.
 */
async function launchOrPullAndRetry(
	job: Job<CascadeJob>,
	jobId: string,
	containerName: string,
	projectId: string | null,
	workItemId: string | undefined,
	agentType: string | undefined,
	config: WorkerContainerLaunchConfig,
): Promise<void> {
	try {
		await launchConfiguredWorkerContainer(
			job,
			jobId,
			containerName,
			projectId,
			workItemId,
			agentType,
			config,
		);
	} catch (err) {
		if (!isImageNotFoundError(err) || config.workerImage !== routerConfig.workerImage) {
			throw err;
		}
		const imageName = config.workerImage;
		logger.info('[WorkerManager] Base worker image missing — pulling', { jobId, imageName });
		try {
			await pullImageOnce(imageName);
		} catch (pullErr) {
			logger.error('[WorkerManager] Failed to pull base worker image:', {
				jobId,
				imageName,
				error: String(pullErr),
			});
			captureException(pullErr, {
				tags: { source: 'worker_image_pull_fallback', jobType: job.data.type },
				extra: { jobId, imageName },
			});
			// Propagate the pull error (not the original 404) so the dispatch-error
			// classifier can see its actual shape — registry 429s, ECONNRESET, and
			// other transient pull failures should burn a BullMQ retry instead of
			// being misclassified as terminal via `isImageNotFoundError`.
			throw pullErr;
		}
		logger.info('[WorkerManager] Base image pulled, retrying spawn', { jobId, imageName });
		await launchConfiguredWorkerContainer(
			job,
			jobId,
			containerName,
			projectId,
			workItemId,
			agentType,
			config,
		);
	}
}

/**
 * Spawn a worker container for a job.
 * Sets up timeout tracking and monitors container exit asynchronously.
 *
 * Snapshot behaviour (when the project has snapshotEnabled):
 * - Prefers a valid snapshot image over the base worker image when available.
 * - Disables AutoRemove so the container can be committed on clean exit.
 * - On successful exit, commits the container to a snapshot image.
 * - On failed/timed-out exit, does NOT create a snapshot.
 * - If the snapshot image is missing (deleted externally), invalidates the stale
 *   registry entry and retries transparently with the base worker image.
 */
export async function spawnWorker(job: Job<CascadeJob>): Promise<void> {
	const jobId = job.id ?? `unknown-${Date.now()}`;
	const containerName = buildWorkerContainerName(jobId);

	// Resolve projectId once — used for both credential env and work-item lock tracking
	const projectId = await extractProjectIdFromJob(job.data);

	// Extract agentType early so it can be included in container labels
	// (needed by orphan cleanup to narrow DB fallback queries to the right agent type)
	const agentType = extractAgentType(job.data);

	const workItemId = extractWorkItemId(job.data);

	const { snapshotEnabled, workerImage, containerTimeoutMs } = await resolveSpawnSettings(
		projectId,
		workItemId,
		jobId,
	);

	// A snapshot is being reused when snapshotEnabled and the image differs from the base image.
	const snapshotReuse = snapshotEnabled && workerImage !== routerConfig.workerImage;

	const workerEnv = await buildWorkerEnvWithProjectId(
		job,
		projectId,
		snapshotReuse,
		snapshotEnabled,
	);
	const hasCredentials = workerEnv.some((e) => e.startsWith('CASCADE_CREDENTIAL_KEYS='));

	logger.info('[WorkerManager] Spawning worker:', {
		jobId,
		type: job.data.type,
		containerName,
		hasCredentials,
		snapshotEnabled,
		workerImage,
	});

	const launchConfig: WorkerContainerLaunchConfig = {
		workerImage,
		snapshotEnabled,
		containerTimeoutMs,
		workerEnv,
	};

	try {
		await launchOrPullAndRetry(
			job,
			jobId,
			containerName,
			projectId,
			workItemId,
			agentType,
			launchConfig,
		);
	} catch (err) {
		// Snapshot image deleted externally — invalidate the stale registry entry and
		// retry transparently with the base worker image.
		if (snapshotReuse && projectId && workItemId && isImageNotFoundError(err)) {
			logger.warn(
				'[WorkerManager] Snapshot image not found — invalidating and retrying with base image:',
				{ jobId, staleImage: workerImage },
			);
			invalidateSnapshot(projectId, workItemId);
			const fallbackEnv = await buildWorkerEnvWithProjectId(job, projectId, false, snapshotEnabled);
			const fallbackConfig: WorkerContainerLaunchConfig = {
				workerImage: routerConfig.workerImage,
				snapshotEnabled,
				containerTimeoutMs,
				workerEnv: fallbackEnv,
			};
			try {
				await launchOrPullAndRetry(
					job,
					jobId,
					containerName,
					projectId,
					workItemId,
					agentType,
					fallbackConfig,
				);
				return;
			} catch (fallbackErr) {
				logger.error('[WorkerManager] Failed to spawn worker with fallback base image:', {
					jobId,
					error: String(fallbackErr),
				});
				captureException(fallbackErr, {
					tags: { source: 'worker_spawn_fallback', jobType: job.data.type },
					extra: { jobId, staleImage: workerImage },
				});
				throw fallbackErr;
			}
		}

		logger.error('[WorkerManager] Failed to spawn worker:', {
			jobId,
			error: String(err),
		});
		captureException(err, {
			tags: { source: 'worker_spawn', jobType: job.data.type },
			extra: { jobId },
		});
		throw err;
	}
}

/**
 * Detach from all active workers on shutdown.
 * Workers continue running as independent containers.
 * Clears timeout handles so the router process can exit cleanly.
 */
export function detachAll(): void {
	if (activeWorkers.size > 0) {
		logger.info('[WorkerManager] Detaching from active workers (will continue running):', {
			count: activeWorkers.size,
			workers: Array.from(activeWorkers.keys()),
		});
	}

	for (const [, worker] of activeWorkers) {
		clearTimeout(worker.timeoutHandle);
	}
	activeWorkers.clear();
	clearAllWorkItemLocks();
	clearAllAgentTypeLocks();
	stopOrphanCleanup();
}
