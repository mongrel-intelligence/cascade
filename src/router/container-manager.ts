/**
 * Docker container lifecycle management for CASCADE worker processes.
 *
 * Handles spawning, monitoring, killing, and tracking of worker containers.
 * Each BullMQ job gets its own isolated Docker container.
 */

import type { Job } from 'bullmq';
import Docker from 'dockerode';
import { findProjectByRepo, getAllProjectCredentials } from '../config/provider.js';
import { failOrphanedRun } from '../db/repositories/runsRepository.js';
import { captureException } from '../sentry.js';
import { logger } from '../utils/logging.js';
import { clearAgentTypeEnqueued, clearAllAgentTypeLocks } from './agent-type-lock.js';
import { routerConfig } from './config.js';
import { notifyTimeout } from './notifications.js';
import type { CascadeJob } from './queue.js';
import { clearAllWorkItemLocks, clearWorkItemEnqueued } from './work-item-lock.js';

const docker = new Docker();

export interface ActiveWorker {
	containerId: string;
	jobId: string;
	startedAt: Date;
	timeoutHandle: NodeJS.Timeout;
	job: CascadeJob;
	/** Resolved at spawn time for work-item lock cleanup. */
	projectId?: string;
	/** Resolved at spawn time for work-item lock cleanup. */
	workItemId?: string;
	/** Resolved at spawn time for agent-type lock cleanup. */
	agentType?: string;
}

const activeWorkers = new Map<string, ActiveWorker>();

/**
 * Extract projectId from job data for credential resolution.
 * Different job types have the projectId in different locations.
 *
 * Note: Dashboard jobs (manual-run, retry-run, debug-analysis) come through
 * cascade-dashboard-jobs queue and are cast to CascadeJob for spawning.
 */
export async function extractProjectIdFromJob(data: CascadeJob): Promise<string | null> {
	// Use type assertion since dashboard jobs are cast to CascadeJob
	const jobData = data as unknown as { type: string; projectId?: string; repoFullName?: string };

	if (jobData.type === 'trello' || jobData.type === 'jira') {
		return jobData.projectId ?? null;
	}
	if (jobData.type === 'github') {
		if (!jobData.repoFullName) return null;
		const project = await findProjectByRepo(jobData.repoFullName);
		return project?.id ?? null;
	}
	if (jobData.type === 'manual-run' || jobData.type === 'debug-analysis') {
		return jobData.projectId ?? null;
	}
	if (jobData.type === 'retry-run') {
		// Retry jobs now include projectId from the API
		return jobData.projectId ?? null;
	}
	return null;
}

/**
 * Build environment variables for a worker container.
 * Resolves project credentials and forwards required infrastructure env vars.
 */
export async function buildWorkerEnv(job: Job<CascadeJob>): Promise<string[]> {
	const projectId = await extractProjectIdFromJob(job.data);
	return buildWorkerEnvWithProjectId(job, projectId);
}

async function buildWorkerEnvWithProjectId(
	job: Job<CascadeJob>,
	projectId: string | null,
): Promise<string[]> {
	const env: string[] = [
		`JOB_ID=${job.id}`,
		`JOB_TYPE=${job.data.type}`,
		`JOB_DATA=${JSON.stringify(job.data)}`,
		// Redis for job completion reporting
		`REDIS_URL=${routerConfig.redisUrl}`,
		// Database connection
		`CASCADE_POSTGRES_HOST=${process.env.CASCADE_POSTGRES_HOST || 'postgres'}`,
		`CASCADE_POSTGRES_PORT=${process.env.CASCADE_POSTGRES_PORT || '5432'}`,
		// Database connection for config
		`DATABASE_URL=${process.env.DATABASE_URL || ''}`,
		// Logging
		`LOG_LEVEL=${process.env.LOG_LEVEL || 'info'}`,
	];

	// Resolve project credentials in the router and set as individual env vars.
	// NOTE: CREDENTIAL_MASTER_KEY is intentionally NOT passed to workers.
	if (projectId) {
		try {
			const secrets = await getAllProjectCredentials(projectId);
			for (const [key, value] of Object.entries(secrets)) {
				env.push(`${key}=${value}`);
			}
			env.push(`CASCADE_CREDENTIAL_KEYS=${Object.keys(secrets).join(',')}`);
		} catch (err) {
			logger.warn('[WorkerManager] Failed to resolve credentials for project:', {
				projectId,
				error: String(err),
			});
			captureException(err, {
				tags: { source: 'credential_resolution' },
				extra: { projectId },
				level: 'warning',
			});
		}
	}

	// CLAUDE_CODE_OAUTH_TOKEN is for the Claude Code backend (subscription auth).
	if (process.env.CLAUDE_CODE_OAUTH_TOKEN)
		env.push(`CLAUDE_CODE_OAUTH_TOKEN=${process.env.CLAUDE_CODE_OAUTH_TOKEN}`);

	// Forward Sentry env vars so worker containers report to the same project.
	if (process.env.SENTRY_DSN) env.push(`SENTRY_DSN=${process.env.SENTRY_DSN}`);
	if (process.env.SENTRY_ENVIRONMENT)
		env.push(`SENTRY_ENVIRONMENT=${process.env.SENTRY_ENVIRONMENT}`);
	if (process.env.SENTRY_RELEASE) env.push(`SENTRY_RELEASE=${process.env.SENTRY_RELEASE}`);

	return env;
}

/**
 * Extract work-item ID from job data for concurrency lock tracking.
 * Returns the PM work item identifier (cardId, issueKey, or triggerResult.workItemId).
 */
function extractWorkItemId(data: CascadeJob): string | undefined {
	const jobData = data as unknown as {
		type: string;
		cardId?: string;
		issueKey?: string;
		triggerResult?: { workItemId?: string };
	};

	if (jobData.type === 'trello' && jobData.cardId) return jobData.cardId;
	if (jobData.type === 'jira' && jobData.issueKey) return jobData.issueKey;
	if (jobData.type === 'github') return jobData.triggerResult?.workItemId;
	// Dashboard jobs (manual-run, retry-run, debug-analysis)
	if (jobData.cardId) return jobData.cardId;
	return undefined;
}

/**
 * Extract agent type from job data for concurrency lock tracking.
 * Checks triggerResult.agentType first, then top-level agentType (dashboard jobs).
 */
function extractAgentType(data: CascadeJob): string | undefined {
	const jobData = data as unknown as {
		triggerResult?: { agentType?: string };
		agentType?: string;
	};
	return jobData.triggerResult?.agentType ?? jobData.agentType ?? undefined;
}

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
 * Clean up worker tracking state (timeout handle + map entry).
 * When exitCode is non-zero, marks the corresponding DB run as failed (fire-and-forget).
 */
export function cleanupWorker(jobId: string, exitCode?: number): void {
	const worker = activeWorkers.get(jobId);
	if (worker) {
		clearTimeout(worker.timeoutHandle);
		if (worker.projectId && worker.agentType) {
			clearAgentTypeEnqueued(worker.projectId, worker.agentType);
		}
		if (worker.projectId && worker.workItemId && worker.agentType) {
			clearWorkItemEnqueued(worker.projectId, worker.workItemId, worker.agentType);
		}
		if (worker.projectId && worker.workItemId) {
			if (exitCode !== undefined && exitCode !== 0) {
				failOrphanedRun(
					worker.projectId,
					worker.workItemId,
					`Worker crashed with exit code ${exitCode}`,
				)
					.then((runId) => {
						if (runId) {
							logger.info('[WorkerManager] Marked orphaned run as failed:', {
								jobId,
								runId,
								exitCode,
							});
						}
					})
					.catch((err) => {
						logger.error('[WorkerManager] Failed to mark orphaned run:', {
							jobId,
							error: String(err),
						});
					});
			}
		}
		activeWorkers.delete(jobId);
		logger.info('[WorkerManager] Worker cleaned up:', {
			jobId,
			activeWorkers: activeWorkers.size,
		});
	}
}

/**
 * Get number of currently active worker containers.
 */
export function getActiveWorkerCount(): number {
	return activeWorkers.size;
}

/**
 * Get summary info for currently active workers.
 */
export function getActiveWorkers(): Array<{ jobId: string; startedAt: Date }> {
	return Array.from(activeWorkers.values()).map((w) => ({
		jobId: w.jobId,
		startedAt: w.startedAt,
	}));
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
}
