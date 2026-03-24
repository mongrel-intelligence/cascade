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
 */

import type { Job } from 'bullmq';
import Docker from 'dockerode';
import { failOrphanedRun, failOrphanedRunFallback } from '../db/repositories/runsRepository.js';
import { captureException } from '../sentry.js';
import { logger } from '../utils/logging.js';
import { activeWorkers, cleanupWorker } from './active-workers.js';
import { clearAllAgentTypeLocks } from './agent-type-lock.js';
import { loadProjectConfig, routerConfig } from './config.js';
import { notifyTimeout } from './notifications.js';
import { stopOrphanCleanup } from './orphan-cleanup.js';
import type { CascadeJob } from './queue.js';
import { getSnapshot, registerSnapshot } from './snapshot-manager.js';
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
export {
	getSnapshot,
	invalidateSnapshot,
	registerSnapshot,
} from './snapshot-manager.js';

const docker = new Docker();

/** Buffer added on top of the in-container watchdog so the router kill is always a backstop. */
const ROUTER_KILL_BUFFER_MS = 2 * 60 * 1000;

/**
 * Build a stable Docker image name for a snapshot.
 * Uses a sanitised project+workItem key so it's valid as a Docker image tag.
 */
function buildSnapshotImageName(projectId: string, workItemId: string): string {
	// Sanitise: lowercase, replace non-alphanumeric with '-', collapse runs
	const sanitise = (s: string) =>
		s
			.toLowerCase()
			.replace(/[^a-z0-9]/g, '-')
			.replace(/-+/g, '-')
			.replace(/^-|-$/g, '');
	return `cascade-snapshot-${sanitise(projectId)}-${sanitise(workItemId)}:latest`;
}

/**
 * Commit a container to a snapshot image and register the metadata.
 * On failure the error is logged and swallowed — snapshot failure must not
 * break the normal post-run flow.
 */
async function commitContainerToSnapshot(
	containerId: string,
	projectId: string,
	workItemId: string,
): Promise<void> {
	const imageName = buildSnapshotImageName(projectId, workItemId);
	try {
		const container = docker.getContainer(containerId);
		await container.commit({ repo: imageName.split(':')[0], tag: 'latest' });
		registerSnapshot(projectId, workItemId, imageName);
		logger.info('[WorkerManager] Committed container to snapshot image:', {
			containerId: containerId.slice(0, 12),
			imageName,
			projectId,
			workItemId,
		});
	} catch (err) {
		logger.warn('[WorkerManager] Failed to commit container to snapshot (non-fatal):', {
			containerId: containerId.slice(0, 12),
			imageName,
			error: String(err),
		});
		captureException(err, {
			tags: { source: 'snapshot_commit' },
			extra: { containerId, imageName, projectId, workItemId },
			level: 'warning',
		});
	}
}

/**
 * Remove a container (used after manual snapshot commit to clean up).
 * Swallows errors — the container may already be removed.
 */
async function removeContainer(containerId: string): Promise<void> {
	try {
		const container = docker.getContainer(containerId);
		await container.remove({ force: true });
	} catch {
		// Container may already be removed — not an error
	}
}

interface SpawnSettings {
	snapshotEnabled: boolean;
	workerImage: string;
	containerTimeoutMs: number;
}

/**
 * Resolve per-project spawn settings (snapshot flag, image, timeout).
 * Centralises all loadProjectConfig() calls so spawnWorker stays simple.
 */
async function resolveSpawnSettings(
	projectId: string | null,
	workItemId: string | undefined,
	jobId: string,
): Promise<SpawnSettings> {
	let snapshotEnabled = false;
	let workerImage = routerConfig.workerImage;
	let containerTimeoutMs = routerConfig.workerTimeoutMs;

	if (!projectId) return { snapshotEnabled, workerImage, containerTimeoutMs };

	const { fullProjects } = await loadProjectConfig();
	const projectCfg = fullProjects.find((p) => p.id === projectId);

	// Project-level snapshotEnabled overrides the global default
	snapshotEnabled = projectCfg?.snapshotEnabled ?? routerConfig.snapshotEnabled;

	if (snapshotEnabled && workItemId) {
		const snapshot = getSnapshot(projectId, workItemId);
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

	// Determine container timeout: use project's watchdogTimeoutMs + buffer if available,
	// falling back to the global workerTimeoutMs. This makes watchdogTimeoutMs the single source
	// of truth — the in-container watchdog fires first, router kill is a backup.
	if (projectCfg?.watchdogTimeoutMs) {
		containerTimeoutMs = projectCfg.watchdogTimeoutMs + ROUTER_KILL_BUFFER_MS;
	}

	return { snapshotEnabled, workerImage, containerTimeoutMs };
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
 */
export async function spawnWorker(job: Job<CascadeJob>): Promise<void> {
	const jobId = job.id ?? `unknown-${Date.now()}`;
	const containerName = `cascade-worker-${jobId}`;

	// Resolve projectId once — used for both credential env and work-item lock tracking
	const projectId = await extractProjectIdFromJob(job.data);
	const workerEnv = await buildWorkerEnvWithProjectId(job, projectId);
	const hasCredentials = workerEnv.some((e) => e.startsWith('CASCADE_CREDENTIAL_KEYS='));

	// Extract agentType early so it can be included in container labels
	// (needed by orphan cleanup to narrow DB fallback queries to the right agent type)
	const agentType = extractAgentType(job.data);

	const workItemId = extractWorkItemId(job.data);

	const { snapshotEnabled, workerImage, containerTimeoutMs } = await resolveSpawnSettings(
		projectId,
		workItemId,
		jobId,
	);

	logger.info('[WorkerManager] Spawning worker:', {
		jobId,
		type: job.data.type,
		containerName,
		hasCredentials,
		snapshotEnabled,
		workerImage,
	});

	try {
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
				// Collect worker logs before removal
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

				// For snapshot-enabled runs, commit on clean exit and then remove the container.
				// Failed or timed-out runs must NOT create a snapshot.
				// Always remove — even when projectId/workItemId are absent — to avoid
				// orphaning containers that ran with AutoRemove=false.
				if (snapshotEnabled) {
					if (result.StatusCode === 0 && projectId && workItemId) {
						await commitContainerToSnapshot(container.id, projectId, workItemId);
					} else if (result.StatusCode !== 0) {
						logger.info('[WorkerManager] Skipping snapshot commit after non-zero exit:', {
							jobId,
							statusCode: result.StatusCode,
						});
					}
					// Always remove the container manually since AutoRemove is disabled
					await removeContainer(container.id);
				}

				cleanupWorker(jobId, result.StatusCode);
			})
			.catch((err) => {
				logger.error('[WorkerManager] Error waiting for container:', err);
				captureException(err, {
					tags: { source: 'worker_wait', jobType: job.data.type },
					extra: { jobId },
				});
				// Ensure container is cleaned up even on wait error (snapshot runs only)
				if (snapshotEnabled) {
					removeContainer(container.id).catch(() => {});
				}
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

	const durationMs = Date.now() - worker.startedAt.getTime();

	// Update DB run status to timed_out (fire-and-forget, no-op if watchdog already did it).
	// cleanupWorker is called below without an exitCode so it skips its own DB update,
	// avoiding a race where the wrong status ('failed') could win.
	if (worker.projectId) {
		const dbUpdate = worker.workItemId
			? failOrphanedRun(
					worker.projectId,
					worker.workItemId,
					'Router timeout',
					'timed_out',
					durationMs,
				)
			: failOrphanedRunFallback(
					worker.projectId,
					worker.agentType,
					worker.startedAt,
					'timed_out',
					'Router timeout',
					durationMs,
				);
		dbUpdate
			.then((runId) => {
				if (runId)
					logger.info('[WorkerManager] Marked run timed_out after router kill', {
						jobId,
						runId,
					});
			})
			.catch((err) =>
				logger.error('[WorkerManager] DB update failed after router kill', {
					jobId,
					error: String(err),
				}),
			);
	}

	// Send timeout notification (fire-and-forget)
	notifyTimeout(worker.job, {
		jobId: worker.jobId,
		startedAt: worker.startedAt,
		durationMs,
	}).catch((err) => {
		logger.error('[WorkerManager] Timeout notification error:', String(err));
	});

	// No exitCode — DB update is handled above with the correct 'timed_out' status
	cleanupWorker(jobId);
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
