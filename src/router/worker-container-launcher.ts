/**
 * Docker create/start/wait wiring for CASCADE worker containers.
 *
 * container-manager.ts owns orchestration decisions; this module owns the
 * Docker launch shape, active-worker registration, router timeout timer, and
 * async wait handling for one worker container.
 */

import type { Job } from 'bullmq';
import Docker from 'dockerode';
import { captureException as captureExceptionDefault } from '../sentry.js';
import { logger } from '../utils/logging.js';
import { activeWorkers, cleanupWorker } from './active-workers.js';
import { routerConfig } from './config.js';
import { ROUTER_INSTANCE_ID } from './instance-id.js';
import type { CascadeJob } from './queue.js';
import { handleWorkerExit } from './worker-exit-handler.js';
import { commitWorkerSnapshot, removeWorkerContainerBestEffort } from './worker-snapshots.js';
import { killWorker } from './worker-timeouts.js';

type WorkerContainer = Docker.Container;

const docker = new Docker();

export interface WorkerContainerLaunchConfig {
	workerImage: string;
	snapshotEnabled: boolean;
	containerTimeoutMs: number;
	workerEnv: string[];
}

export interface WorkerContainerLaunchContext {
	job: Job<CascadeJob>;
	jobId: string;
	containerName: string;
	projectId: string | null;
	workItemId: string | undefined;
	agentType: string | undefined;
}

export interface WorkerContainerLauncherDependencies {
	createContainer: Docker['createContainer'];
	killWorker: (jobId: string) => Promise<void>;
	handleWorkerExit: typeof handleWorkerExit;
	commitWorkerSnapshot: typeof commitWorkerSnapshot;
	removeWorkerContainerBestEffort: typeof removeWorkerContainerBestEffort;
	cleanupWorker: typeof cleanupWorker;
	captureException: typeof captureExceptionDefault;
}

const defaultDependencies: WorkerContainerLauncherDependencies = {
	createContainer: docker.createContainer.bind(docker),
	killWorker,
	handleWorkerExit,
	commitWorkerSnapshot,
	removeWorkerContainerBestEffort,
	cleanupWorker,
	captureException: captureExceptionDefault,
};

/**
 * Create, start, and set up async exit monitoring for a single worker
 * container. Returns immediately after Docker start succeeds; wait handling
 * continues in the background.
 */
export async function launchWorkerContainer(
	context: WorkerContainerLaunchContext,
	config: WorkerContainerLaunchConfig,
	dependencies: WorkerContainerLauncherDependencies = defaultDependencies,
): Promise<void> {
	const { job, jobId, containerName, projectId, workItemId, agentType } = context;
	const { workerImage, snapshotEnabled, containerTimeoutMs, workerEnv } = config;

	const container = (await dependencies.createContainer({
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
			// cascade-router instances on the same host from claiming each other's
			// containers as orphans. See `instance-id.ts` and orphan cleanup.
			'cascade.router.instance': ROUTER_INSTANCE_ID,
			'cascade.project.id': projectId ?? '',
			'cascade.agent.type': agentType ?? '',
			'cascade.snapshot.enabled': snapshotEnabled ? 'true' : 'false',
		},
	})) as WorkerContainer;

	await container.start();

	const startedAt = new Date();
	const timeoutHandle = setTimeout(() => {
		const durationMs = Date.now() - startedAt.getTime();
		logger.warn('[WorkerManager] Worker timeout, killing:', {
			jobId,
			durationMs,
		});
		dependencies.captureException(new Error(`Worker timeout after ${durationMs}ms`), {
			tags: { source: 'worker_timeout', jobType: job.data.type },
			extra: { jobId, durationMs },
			level: 'warning',
		});
		dependencies.killWorker(jobId).catch((err) => {
			logger.error('[WorkerManager] Failed to kill timed-out worker:', err);
		});
	}, containerTimeoutMs);

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

	monitorContainerExit(container, context, config, dependencies);
}

function monitorContainerExit(
	container: WorkerContainer,
	context: WorkerContainerLaunchContext,
	config: WorkerContainerLaunchConfig,
	dependencies: WorkerContainerLauncherDependencies,
): void {
	const { job, jobId, projectId, workItemId } = context;
	const { snapshotEnabled } = config;

	container
		.wait()
		.then(async (result) => {
			await dependencies.handleWorkerExit({
				container,
				result,
				jobId,
				jobType: job.data.type,
				snapshotEnabled,
				projectId,
				workItemId,
				dependencies: {
					commitWorkerSnapshot: dependencies.commitWorkerSnapshot,
					removeWorkerContainerBestEffort: dependencies.removeWorkerContainerBestEffort,
					cleanupWorker: dependencies.cleanupWorker,
				},
			});
		})
		.catch((err) => {
			logger.error('[WorkerManager] Error waiting for container:', err);
			dependencies.captureException(err, {
				tags: { source: 'worker_wait', jobType: job.data.type },
				extra: { jobId },
			});
			// Ensure container is cleaned up even on wait error (snapshot runs only).
			if (snapshotEnabled) {
				dependencies.removeWorkerContainerBestEffort(container.id).catch(() => {});
			}
			dependencies.cleanupWorker(jobId);
		});
}
