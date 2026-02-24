/**
 * Orchestrator for CASCADE worker processing.
 *
 * Wires together BullMQ queue consumers (bullmq-workers.ts) and Docker
 * container lifecycle management (container-manager.ts).
 *
 * Public API is unchanged — all consumers continue importing from this module.
 */

import type { Job, Worker } from 'bullmq';
import { logger } from '../utils/logging.js';
import { createQueueWorker, parseRedisUrl } from './bullmq-workers.js';
import { routerConfig } from './config.js';
import {
	detachAll,
	getActiveWorkerCount,
	getActiveWorkers,
	spawnWorker,
} from './container-manager.js';
import type { CascadeJob } from './queue.js';

// Re-export container-manager public API so existing callers are unaffected.
export { getActiveWorkerCount, getActiveWorkers };

// BullMQ Workers that process jobs by spawning containers
let bullWorker: Worker<CascadeJob> | null = null;
let dashboardWorker: Worker | null = null;

/** Guard that enforces the per-router concurrency cap before spawning. */
async function guardedSpawn(job: Job<CascadeJob>): Promise<void> {
	// Check if we have capacity.
	// This shouldn't happen with proper concurrency settings,
	// but just in case, throw to retry later.
	if (getActiveWorkerCount() >= routerConfig.maxWorkers) {
		throw new Error('No worker slots available');
	}
	await spawnWorker(job);
	// Note: We don't wait for the container to complete here.
	// The job is considered "processed" once the container starts.
	// Container exit is handled asynchronously.
}

export function startWorkerProcessor(): void {
	if (bullWorker) {
		logger.warn('[WorkerManager] Worker processor already started');
		return;
	}

	const connection = parseRedisUrl(routerConfig.redisUrl);

	bullWorker = createQueueWorker<CascadeJob>({
		queueName: 'cascade-jobs',
		label: 'Job',
		connection,
		concurrency: routerConfig.maxWorkers,
		lockDuration: routerConfig.workerTimeoutMs + 60000,
		processFn: guardedSpawn,
	});

	// Dashboard jobs queue — manual runs, retries, debug analyses submitted
	// from the dashboard API container.
	dashboardWorker = createQueueWorker({
		queueName: 'cascade-dashboard-jobs',
		label: 'Dashboard job',
		connection,
		concurrency: routerConfig.maxWorkers,
		lockDuration: routerConfig.workerTimeoutMs + 60000,
		processFn: (job) => guardedSpawn(job as Job<CascadeJob>),
	});

	logger.info('[WorkerManager] Started with max', routerConfig.maxWorkers, 'concurrent workers');
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
	detachAll();

	logger.info('[WorkerManager] Stopped');
}
