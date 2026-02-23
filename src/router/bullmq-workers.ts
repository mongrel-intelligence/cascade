/**
 * BullMQ worker factory for CASCADE queue consumers.
 *
 * Provides a `createQueueWorker` factory that de-duplicates the event handler
 * boilerplate shared across all queue workers (completed/failed/error logging
 * and Sentry capture).
 */

import { type ConnectionOptions, type Job, Worker } from 'bullmq';
import { captureException } from '../sentry.js';

export interface QueueWorkerConfig<T = unknown> {
	queueName: string;
	/** Human-readable label used in log messages and Sentry tags */
	label: string;
	connection: ConnectionOptions;
	concurrency: number;
	lockDuration: number;
	processFn: (job: Job<T>) => Promise<void>;
}

/**
 * Parse a Redis URL string into BullMQ ConnectionOptions.
 */
export function parseRedisConnection(redisUrl: string): ConnectionOptions {
	const parsed = new URL(redisUrl);
	return {
		host: parsed.hostname,
		port: Number(parsed.port) || 6379,
		password: parsed.password || undefined,
	};
}

/**
 * Factory that creates a BullMQ Worker with standard event handlers.
 *
 * All cascade queue workers share the same completed/failed/error handling
 * pattern — this factory de-duplicates that boilerplate while keeping
 * per-queue differences (name, label, processFn) configurable.
 */
export function createQueueWorker<T = unknown>(config: QueueWorkerConfig<T>): Worker<T> {
	const { queueName, label, connection, concurrency, lockDuration, processFn } = config;

	const worker = new Worker<T>(queueName, processFn, {
		connection,
		concurrency,
		lockDuration,
	});

	worker.on('completed', (job) => {
		console.log(`[WorkerManager] ${label} dispatched:`, { jobId: job.id });
	});

	worker.on('failed', (job, err) => {
		console.error(`[WorkerManager] ${label} failed to dispatch:`, {
			jobId: job?.id,
			error: String(err),
		});
		captureException(err, {
			tags: { source: 'bullmq_dispatch', queue: queueName },
			extra: { jobId: job?.id },
		});
	});

	worker.on('error', (err) => {
		console.error(`[WorkerManager] ${label} worker error:`, err);
		captureException(err, {
			tags: { source: 'bullmq_error', queue: queueName },
		});
	});

	return worker;
}
