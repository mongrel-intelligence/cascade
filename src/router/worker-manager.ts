import { type Job, Worker } from 'bullmq';
import Docker from 'dockerode';
import { findProjectByRepo, getProjectSecrets } from '../config/provider.js';
import { captureWorkerError } from '../utils/sentry.js';
import { routerConfig } from './config.js';
import { notifyTimeout } from './notifications.js';
import type { CascadeJob } from './queue.js';

const docker = new Docker();

interface ActiveWorker {
	containerId: string;
	jobId: string;
	startedAt: Date;
	timeoutHandle: NodeJS.Timeout;
	job: CascadeJob;
}

const activeWorkers = new Map<string, ActiveWorker>();

/**
 * Extract projectId from job data for credential resolution.
 * Different job types have the projectId in different locations.
 *
 * Note: Dashboard jobs (manual-run, retry-run, debug-analysis) come through
 * cascade-dashboard-jobs queue and are cast to CascadeJob for spawning.
 */
async function extractProjectIdFromJob(data: CascadeJob): Promise<string | null> {
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

// Build environment variables for worker container
async function buildWorkerEnv(job: Job<CascadeJob>): Promise<string[]> {
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

	// Resolve project credentials in the router and pass as JSON.
	// Workers cache these on startup, then scrub from env.
	// NOTE: CREDENTIAL_MASTER_KEY is intentionally NOT passed to workers.
	const projectId = await extractProjectIdFromJob(job.data);
	if (projectId) {
		try {
			const secrets = await getProjectSecrets(projectId);
			env.push(`CASCADE_CREDENTIALS=${JSON.stringify(secrets)}`);
			env.push(`CASCADE_CREDENTIALS_PROJECT_ID=${projectId}`);
		} catch (err) {
			console.warn('[WorkerManager] Failed to resolve credentials for project:', {
				projectId,
				error: String(err),
			});
		}
	}

	// CLAUDE_CODE_OAUTH_TOKEN is for the Claude Code backend (subscription auth).
	if (process.env.CLAUDE_CODE_OAUTH_TOKEN)
		env.push(`CLAUDE_CODE_OAUTH_TOKEN=${process.env.CLAUDE_CODE_OAUTH_TOKEN}`);

	// SENTRY_DSN is a public identifier (not a secret); pass to workers for error reporting.
	if (process.env.SENTRY_DSN) env.push(`SENTRY_DSN=${process.env.SENTRY_DSN}`);

	return env;
}

// Spawn a worker container for a job
async function spawnWorker(job: Job<CascadeJob>): Promise<void> {
	const jobId = job.id ?? `unknown-${Date.now()}`;
	const containerName = `cascade-worker-${jobId}`;

	const workerEnv = await buildWorkerEnv(job);
	const hasCredentials = workerEnv.some((e) => e.startsWith('CASCADE_CREDENTIALS='));

	console.log('[WorkerManager] Spawning worker:', {
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
			console.warn('[WorkerManager] Worker timeout, killing:', {
				jobId,
				durationMs,
			});
			killWorker(jobId).catch((err) => {
				console.error('[WorkerManager] Failed to kill timed-out worker:', err);
			});
		}, routerConfig.workerTimeoutMs);

		// Track the worker
		activeWorkers.set(jobId, {
			containerId: container.id,
			jobId,
			startedAt,
			timeoutHandle,
			job: job.data,
		});

		console.log('[WorkerManager] Worker started:', {
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
						console.log(
							`[WorkerManager] Worker logs (last ${Math.min(lines.length, 50)} of ${lines.length} lines):\n${tail}`,
						);
					}
				} catch {
					// Container may already be removed — expected with AutoRemove
				}

				console.log('[WorkerManager] Worker exited:', {
					jobId,
					statusCode: result.StatusCode,
				});
				cleanupWorker(jobId);
			})
			.catch((err) => {
				console.error('[WorkerManager] Error waiting for container:', err);
				cleanupWorker(jobId);
			});
	} catch (err) {
		console.error('[WorkerManager] Failed to spawn worker:', {
			jobId,
			error: String(err),
		});
		captureWorkerError(err, { jobId, jobType: job.data.type });
		throw err;
	}
}

// Kill a worker container with two-phase shutdown:
// 1. SIGTERM via container.stop(t=15) — gives agent watchdog 15s to clean up
// 2. Docker auto-escalates to SIGKILL after 15s
// 3. Router posts its own timeout notification
async function killWorker(jobId: string): Promise<void> {
	const worker = activeWorkers.get(jobId);
	if (!worker) return;

	try {
		const container = docker.getContainer(worker.containerId);
		await container.stop({ t: 15 });
		console.log('[WorkerManager] Worker stopped:', { jobId });
	} catch (err) {
		// Container might already be stopped
		console.warn('[WorkerManager] Error stopping worker (may already be stopped):', {
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
		console.error('[WorkerManager] Timeout notification error:', String(err));
	});

	cleanupWorker(jobId);
}

// Clean up worker tracking
function cleanupWorker(jobId: string): void {
	const worker = activeWorkers.get(jobId);
	if (worker) {
		clearTimeout(worker.timeoutHandle);
		activeWorkers.delete(jobId);
		console.log('[WorkerManager] Worker cleaned up:', {
			jobId,
			activeWorkers: activeWorkers.size,
		});
	}
}

// Get active worker count
export function getActiveWorkerCount(): number {
	return activeWorkers.size;
}

// Get active worker info
export function getActiveWorkers(): Array<{ jobId: string; startedAt: Date }> {
	return Array.from(activeWorkers.values()).map((w) => ({
		jobId: w.jobId,
		startedAt: w.startedAt,
	}));
}

// BullMQ Worker that processes jobs by spawning containers
let bullWorker: Worker<CascadeJob> | null = null;
let dashboardWorker: Worker | null = null;

export function startWorkerProcessor(): void {
	if (bullWorker) {
		console.warn('[WorkerManager] Worker processor already started');
		return;
	}

	const redisConnection = {
		host: new URL(routerConfig.redisUrl).hostname,
		port: Number(new URL(routerConfig.redisUrl).port) || 6379,
	};

	bullWorker = new Worker<CascadeJob>(
		'cascade-jobs',
		async (job) => {
			// Check if we have capacity
			if (activeWorkers.size >= routerConfig.maxWorkers) {
				// This shouldn't happen with proper concurrency settings,
				// but just in case, throw to retry later
				throw new Error('No worker slots available');
			}

			await spawnWorker(job);

			// Note: We don't wait for the container to complete here.
			// The job is considered "processed" once the container starts.
			// Container exit is handled asynchronously.
		},
		{
			connection: redisConnection,
			concurrency: routerConfig.maxWorkers,
			// Lock jobs for the timeout duration plus buffer
			lockDuration: routerConfig.workerTimeoutMs + 60000,
		},
	);

	bullWorker.on('completed', (job) => {
		console.log('[WorkerManager] Job dispatched:', { jobId: job.id });
	});

	bullWorker.on('failed', (job, err) => {
		console.error('[WorkerManager] Job failed to dispatch:', {
			jobId: job?.id,
			error: String(err),
		});
		captureWorkerError(err, { jobId: job?.id, jobType: job?.data?.type });
	});

	bullWorker.on('error', (err) => {
		console.error('[WorkerManager] Worker error:', err);
	});

	// Dashboard jobs queue — manual runs, retries, debug analyses submitted
	// from the dashboard API container
	dashboardWorker = new Worker(
		'cascade-dashboard-jobs',
		async (job) => {
			if (activeWorkers.size >= routerConfig.maxWorkers) {
				throw new Error('No worker slots available');
			}
			// Dashboard jobs are forwarded as worker containers with the same
			// JOB_TYPE / JOB_DATA protocol that worker-entry.ts understands.
			await spawnWorker(job as Job<CascadeJob>);
		},
		{
			connection: redisConnection,
			concurrency: routerConfig.maxWorkers,
			lockDuration: routerConfig.workerTimeoutMs + 60000,
		},
	);

	dashboardWorker.on('completed', (job) => {
		console.log('[WorkerManager] Dashboard job dispatched:', { jobId: job.id });
	});

	dashboardWorker.on('failed', (job, err) => {
		console.error('[WorkerManager] Dashboard job failed to dispatch:', {
			jobId: job?.id,
			error: String(err),
		});
		captureWorkerError(err, { jobId: job?.id, jobType: (job?.data as { type?: string })?.type });
	});

	dashboardWorker.on('error', (err) => {
		console.error('[WorkerManager] Dashboard worker error:', err);
	});

	console.log('[WorkerManager] Started with max', routerConfig.maxWorkers, 'concurrent workers');
}

// Graceful shutdown — detach from workers, let them finish independently
export async function stopWorkerProcessor(): Promise<void> {
	if (dashboardWorker) {
		await dashboardWorker.close();
		dashboardWorker = null;
	}
	if (bullWorker) {
		await bullWorker.close();
		bullWorker = null;
	}

	// Don't kill active workers — they're independent containers that will
	// finish their jobs and auto-remove. Workers have their own internal
	// watchdog (src/utils/lifecycle.ts) for timeout enforcement.
	if (activeWorkers.size > 0) {
		console.log('[WorkerManager] Detaching from active workers (will continue running):', {
			count: activeWorkers.size,
			workers: Array.from(activeWorkers.keys()),
		});
	}

	// Clear timeout handles so the router process can exit cleanly
	for (const [, worker] of activeWorkers) {
		clearTimeout(worker.timeoutHandle);
	}
	activeWorkers.clear();

	console.log('[WorkerManager] Stopped');
}
