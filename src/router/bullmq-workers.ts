/**
 * BullMQ worker factory for CASCADE queue consumers.
 *
 * Provides a `createQueueWorker` factory that de-duplicates the event handler
 * boilerplate shared across all queue workers (completed/failed/error logging
 * and Sentry capture).
 */

import { type ConnectionOptions, type Job, UnrecoverableError, Worker } from 'bullmq';
import { captureException } from '../sentry.js';
import { logger } from '../utils/logging.js';
import { parseRedisUrl } from '../utils/redis.js';
import { recordSpawnFailureStub, releaseLocksForFailedJob } from './dispatch-compensator.js';

// Re-export so existing callers (worker-manager.ts) don't need to change imports.
export { parseRedisUrl };

/**
 * BullMQ emits the `failed` event on EVERY attempt, including intermediate
 * retries: `Worker.handleFailed` calls `job.moveToFailed(...)` and then
 * `emit('failed', ...)` unconditionally. On a retryable attempt
 * (`attemptsMade < attempts` and the error is not an `UnrecoverableError`),
 * `moveToFailed` re-queues the job to `delayed` and leaves `finishedOn` UNSET;
 * only a terminal failure (retries exhausted, or `UnrecoverableError`) sets
 * `finishedOn`.
 *
 * Spec 015 deliberately propagates transient spawn errors (registry 429 /
 * ECONNRESET / ECONNREFUSED / ENOTFOUND / 409 / SLOT_WAIT_TIMEOUT) unchanged so
 * BullMQ retries them via `attempts: 4`. A side effect — recorded as a `failed`
 * stub run row per emission — would therefore plant one bogus row per
 * intermediate retry for a transient error that later succeeds. So any such
 * side effect must run ONLY on a terminal failure.
 *
 * `finishedOn` is the canonical terminal signal and matches BullMQ's own
 * retry/terminal branch; the exhausted-attempts and `UnrecoverableError` checks
 * are defensive fallbacks should a BullMQ build leave `finishedOn` unset on a
 * terminal emission. The name check guards against a cross-realm/duplicate-copy
 * `UnrecoverableError` that fails `instanceof`.
 */
export function isTerminalDispatchFailure(job: Job, err: unknown): boolean {
	if (typeof job.finishedOn === 'number') return true;
	if (
		err instanceof UnrecoverableError ||
		(err as { name?: string } | null)?.name === 'UnrecoverableError'
	) {
		return true;
	}
	const attempts = job.opts?.attempts;
	return typeof attempts === 'number' && attempts > 0 && job.attemptsMade >= attempts;
}

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
		logger.info(`[WorkerManager] ${label} dispatched:`, { jobId: job.id });
	});

	worker.on('failed', (job, err) => {
		logger.error(`[WorkerManager] ${label} failed to dispatch:`, {
			jobId: job?.id,
			error: String(err),
		});
		captureException(err, {
			tags: { source: 'bullmq_dispatch', queue: queueName },
			extra: { jobId: job?.id },
		});
		// Compensate in-memory state (work-item lock, agent-type lock,
		// recently-dispatched dedup mark) acquired by the webhook → enqueue
		// path. Without this, dispatch failures wedge the locks until their
		// TTLs expire — see spec 015. Compensator never throws, but we still
		// guard so a future regression in it can't poison the worker.
		if (job) {
			void releaseLocksForFailedJob(job.data).catch((compErr) => {
				logger.error(
					'[WorkerManager] compensator threw — already swallowed by it; logging defensively',
					{
						jobId: job.id,
						error: String(compErr),
					},
				);
				captureException(compErr instanceof Error ? compErr : new Error(String(compErr)), {
					tags: { source: 'dispatch_compensator_uncaught', queue: queueName },
				});
			});
			// Insert a `failed` stub run row so the dispatch is visible in the
			// dashboard / `cascade runs list`. The `failed` event fires on EVERY
			// attempt, so gate this to a TERMINAL failure — otherwise a transient
			// spawn error (deliberately retried per spec 015) that later succeeds
			// would leave one bogus `failed` row per intermediate retry. Lock
			// compensation above must still run on every attempt. Recorder never
			// throws. See `isTerminalDispatchFailure`.
			if (isTerminalDispatchFailure(job, err)) {
				void recordSpawnFailureStub(job.data, err).catch((stubErr) => {
					logger.warn('[WorkerManager] stub-row recorder threw — defensively logged', {
						jobId: job.id,
						error: String(stubErr),
					});
				});
			}
		}
	});

	worker.on('error', (err) => {
		logger.error(`[WorkerManager] ${label} worker error:`, err);
		captureException(err, {
			tags: { source: 'bullmq_error', queue: queueName },
		});
	});

	return worker;
}
