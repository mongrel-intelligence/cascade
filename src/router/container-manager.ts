/**
 * Docker container lifecycle management for CASCADE worker processes.
 *
 * Handles spawning and killing of worker containers.
 * Each BullMQ job gets its own isolated Docker container.
 *
 * State management, env building, and orphan cleanup are in dedicated modules:
 * - active-workers.ts  — ActiveWorker state tracking
 * - worker-env.ts      — Job data parsing + env building
 * - orphan-cleanup.ts  — Periodic orphan container cleanup
 */

import type { Job } from 'bullmq';
import Docker from 'dockerode';
import { captureException } from '../sentry.js';
import { logger } from '../utils/logging.js';
import { activeWorkers, cleanupWorker } from './active-workers.js';
import { clearAllAgentTypeLocks } from './agent-type-lock.js';
import { routerConfig } from './config.js';
import { notifyTimeout } from './notifications.js';
import { stopOrphanCleanup } from './orphan-cleanup.js';
import type { CascadeJob } from './queue.js';
import { clearAllWorkItemLocks } from './work-item-lock.js';
import {
	buildWorkerEnvWithProjectId,
	extractAgentType,
	extractProjectIdFromJob,
	extractWorkItemId,
} from './worker-env.js';

// Re-export from sub-modules so existing callers importing from container-manager.ts
// continue to work without changes.
export type { ActiveWorker } from './active-workers.js';
export {
	cleanupWorker,
	getActiveWorkerCount,
	getActiveWorkers,
} from './active-workers.js';
export {
	startOrphanCleanup,
	stopOrphanCleanup,
	scanAndCleanupOrphans,
} from './orphan-cleanup.js';
export {
	buildWorkerEnv,
	extractProjectIdFromJob,
} from './worker-env.js';

const docker = new Docker();

/**
 * Spawn a worker container for a job.
 * Sets up timeout tracking and monitors container exit asynchronously.
 */
export async function spawnWorker(job: Job<CascadeJob>): Promise<void> {
	const jobId = job.id ?? `unknown-${Date.now()}`;
	const containerName = `cascade-worker-${jobId}`;

	// Resolve projectId once — used for both credential env and work-item lock tracking
	const projectId = await extractProjectIdFromJob(job.data);
	const workerEnv = await buildWorkerEnvWithProjectId(job, projectId);
	const hasCredentials = workerEnv.some((e) => e.startsWith('CASCADE_CREDENTIAL_KEYS='));

	logger.info('[WorkerManager] Spawning worker:', {
		jobId,
		type: job.data.type,
		containerName,
		hasCredentials,
	});

	try {
		const container = await docker.createContainer({
			Image: routerConfig.workerImage,
			name: containerName,
			Env: workerEnv,
			HostConfig: {
				Memory: routerConfig.workerMemoryMb * 1024 * 1024,
				MemorySwap: routerConfig.workerMemoryMb * 1024 * 1024, // No swap
				NetworkMode: routerConfig.dockerNetwork,
				AutoRemove: true, // Clean up container on exit
			},
			Labels: {
				'cascade.job.id': jobId,
				'cascade.job.type': job.data.type,
				'cascade.managed': 'true',
			},
		});

		await container.start();

		// Set up timeout
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
		}, routerConfig.workerTimeoutMs);

		// Track the worker
		const workItemId = extractWorkItemId(job.data);
		const agentType = extractAgentType(job.data);
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
				// Collect worker logs before auto-removal
				try {
					const logs = await container.logs({
						stdout: true,
						stderr: true,
						follow: false,
					});
					const logText = logs.toString('utf-8');
					if (logText.trim()) {
						const lines = logText.trim().split('\n');
						const tail = lines.slice(-50).join('\n');
						logger.info(
							`[WorkerManager] Worker logs (last ${Math.min(lines.length, 50)} of ${lines.length} lines):\n${tail}`,
						);
					}
				} catch {
					// Container may already be removed — expected with AutoRemove
				}

				if (result.StatusCode !== 0) {
					captureException(new Error(`Worker exited with status ${result.StatusCode}`), {
						tags: { source: 'worker_exit', jobType: job.data.type },
						extra: { jobId, statusCode: result.StatusCode },
					});
				}
				logger.info('[WorkerManager] Worker exited:', {
					jobId,
					statusCode: result.StatusCode,
				});
				cleanupWorker(jobId, result.StatusCode);
			})
			.catch((err) => {
				logger.error('[WorkerManager] Error waiting for container:', err);
				captureException(err, {
					tags: { source: 'worker_wait', jobType: job.data.type },
					extra: { jobId },
				});
				cleanupWorker(jobId);
			});
	} catch (err) {
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
 * Kill a worker container with two-phase shutdown:
 * 1. SIGTERM via container.stop(t=15) — gives agent watchdog 15s to clean up
 * 2. Docker auto-escalates to SIGKILL after 15s
 * 3. Router posts its own timeout notification
 */
export async function killWorker(jobId: string): Promise<void> {
	const worker = activeWorkers.get(jobId);
	if (!worker) return;

	try {
		const container = docker.getContainer(worker.containerId);
		await container.stop({ t: 15 });
		logger.info('[WorkerManager] Worker stopped:', { jobId });
	} catch (err) {
		// Container might already be stopped
		logger.warn('[WorkerManager] Error stopping worker (may already be stopped):', {
			jobId,
			error: String(err),
		});
	}

	// Send timeout notification (fire-and-forget)
	const durationMs = Date.now() - worker.startedAt.getTime();
	notifyTimeout(worker.job, {
		jobId: worker.jobId,
		startedAt: worker.startedAt,
		durationMs,
	}).catch((err) => {
		logger.error('[WorkerManager] Timeout notification error:', String(err));
	});

	cleanupWorker(jobId, 137);
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
