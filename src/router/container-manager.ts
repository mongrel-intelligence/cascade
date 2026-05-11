/**
 * Docker container lifecycle management for CASCADE worker processes.
 *
 * Handles spawning and killing of worker containers.
 * Each BullMQ job gets its own isolated Docker container.
 *
 * State management, env building, and orphan cleanup are in dedicated modules:
 * - active-workers.ts    — ActiveWorker state tracking
 * - worker-env.ts        — Job data parsing + env building
 * - orphan-cleanup.ts    — Periodic orphan container cleanup
 * - snapshot-manager.ts  — Snapshot metadata registry
 * - worker-snapshots.ts  — Docker snapshot commit/remove mechanics
 */

import type { Job } from 'bullmq';
import Docker from 'dockerode';
import { captureException } from '../sentry.js';
import { logger } from '../utils/logging.js';
import { activeWorkers, cleanupWorker } from './active-workers.js';
import { clearAllAgentTypeLocks } from './agent-type-lock.js';
import { routerConfig } from './config.js';
import { ROUTER_INSTANCE_ID } from './instance-id.js';
import { stopOrphanCleanup } from './orphan-cleanup.js';
import type { CascadeJob } from './queue.js';
import { invalidateSnapshot } from './snapshot-manager.js';
import { clearAllWorkItemLocks } from './work-item-lock.js';
import {
	buildWorkerEnvWithProjectId,
	extractAgentType,
	extractProjectIdFromJob,
	extractWorkItemId,
} from './worker-env.js';
import { handleWorkerExit } from './worker-exit-handler.js';
import {
	commitWorkerSnapshot,
	isImageNotFoundError,
	removeWorkerContainerBestEffort,
} from './worker-snapshots.js';
import { buildWorkerContainerName, resolveSpawnSettings } from './worker-spawn-settings.js';
import { killWorker } from './worker-timeouts.js';

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

const docker = new Docker();

interface ContainerLaunchConfig {
	workerImage: string;
	snapshotEnabled: boolean;
	containerTimeoutMs: number;
	workerEnv: string[];
}

/**
 * Create, start, and set up async exit-monitoring for a single worker container.
 * Extracted from spawnWorker so snapshot fallback can retry with a different image.
 * Returns immediately after the container starts — exit monitoring runs in the background.
 */
async function createAndMonitorContainer(
	job: Job<CascadeJob>,
	jobId: string,
	containerName: string,
	projectId: string | null,
	workItemId: string | undefined,
	agentType: string | undefined,
	config: ContainerLaunchConfig,
): Promise<void> {
	const { workerImage, snapshotEnabled, containerTimeoutMs, workerEnv } = config;
	const container = await docker.createContainer({
		Image: workerImage,
		name: containerName,
		Env: workerEnv,
		HostConfig: {
			Memory: routerConfig.workerMemoryMb * 1024 * 1024,
			MemorySwap: routerConfig.workerMemoryMb * 1024 * 1024, // No swap
			NetworkMode: routerConfig.dockerNetwork,
			// Disable AutoRemove for snapshot-enabled runs so the container remains
			// available for docker commit after a successful exit.
			AutoRemove: !snapshotEnabled,
		},
		Labels: {
			'cascade.job.id': jobId,
			'cascade.job.type': job.data.type,
			'cascade.managed': 'true',
			// Pinning the spawning router's instance id stops sibling
			// cascade-router instances on the same host from claiming
			// each other's containers as orphans — see `instance-id.ts`
			// and `orphan-cleanup.ts:scanAndCleanupOrphans`.
			'cascade.router.instance': ROUTER_INSTANCE_ID,
			'cascade.project.id': projectId ?? '',
			'cascade.agent.type': agentType ?? '',
			'cascade.snapshot.enabled': snapshotEnabled ? 'true' : 'false',
		},
	});

	await container.start();

	// Set up timeout — fires at watchdogTimeoutMs + 2min (router backup kill)
	const startedAt = new Date();
	const timeoutHandle = setTimeout(() => {
		const durationMs = Date.now() - startedAt.getTime();
		logger.warn('[WorkerManager] Worker timeout, killing:', {
			jobId,
			durationMs,
		});
		captureException(new Error(`Worker timeout after ${durationMs}ms`), {
			tags: { source: 'worker_timeout', jobType: job.data.type },
			extra: { jobId, durationMs },
			level: 'warning',
		});
		killWorker(jobId).catch((err) => {
			logger.error('[WorkerManager] Failed to kill timed-out worker:', err);
		});
	}, containerTimeoutMs);

	// Track the worker
	activeWorkers.set(jobId, {
		containerId: container.id,
		jobId,
		startedAt,
		timeoutHandle,
		job: job.data,
		projectId: projectId ?? undefined,
		workItemId,
		agentType,
	});

	logger.info('[WorkerManager] Worker started:', {
		jobId,
		containerId: container.id.slice(0, 12),
	});

	// Monitor container exit
	container
		.wait()
		.then(async (result) => {
			await handleWorkerExit({
				container,
				result,
				jobId,
				jobType: job.data.type,
				snapshotEnabled,
				projectId,
				workItemId,
				dependencies: {
					commitWorkerSnapshot,
					removeWorkerContainerBestEffort,
					cleanupWorker,
				},
			});
		})
		.catch((err) => {
			logger.error('[WorkerManager] Error waiting for container:', err);
			captureException(err, {
				tags: { source: 'worker_wait', jobType: job.data.type },
				extra: { jobId },
			});
			// Ensure container is cleaned up even on wait error (snapshot runs only)
			if (snapshotEnabled) {
				removeWorkerContainerBestEffort(container.id).catch(() => {});
			}
			cleanupWorker(jobId);
		});
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

	const launchConfig: ContainerLaunchConfig = {
		workerImage,
		snapshotEnabled,
		containerTimeoutMs,
		workerEnv,
	};

	try {
		await createAndMonitorContainer(
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
			const fallbackConfig: ContainerLaunchConfig = {
				workerImage: routerConfig.workerImage,
				snapshotEnabled,
				containerTimeoutMs,
				workerEnv: fallbackEnv,
			};
			try {
				await createAndMonitorContainer(
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
