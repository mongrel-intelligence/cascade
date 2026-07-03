/**
 * Orchestrator for CASCADE worker processing.
 *
 * Wires together BullMQ queue consumers (bullmq-workers.ts) and Docker
 * container lifecycle management (container-manager.ts).
 *
 * Public API is unchanged — all consumers continue importing from this module.
 */

import { type Job, UnrecoverableError, type Worker } from 'bullmq';
import { logger } from '../utils/logging.js';
import { createQueueWorker, parseRedisUrl } from './bullmq-workers.js';
import { routerConfig } from './config.js';
import {
	detachAll,
	getActiveWorkerCount,
	getActiveWorkers,
	spawnWorker,
	startOrphanCleanup,
	stopOrphanCleanup,
} from './container-manager.js';
import { startDanglingImageCleanup, stopDanglingImageCleanup } from './dangling-image-cleanup.js';
import { classifyDispatchError } from './dispatch-error-classifier.js';
import type { CascadeJob } from './queue.js';
import { acquireSlot, clearAllWaiters } from './slot-waiter.js';
import { startSnapshotCleanup, stopSnapshotCleanup } from './snapshot-cleanup.js';
import { syncSnapshotsFromDocker } from './snapshot-startup-sync.js';
import { handleWorkerImageBuild } from './worker-image-build.js';
import { handleWorkerImageValidation } from './worker-image-validation.js';

// Re-export container-manager public API so existing callers are unaffected.
export { getActiveWorkerCount, getActiveWorkers, startOrphanCleanup, stopOrphanCleanup };

// BullMQ Workers that process jobs by spawning containers
let bullWorker: Worker<CascadeJob> | null = null;
let dashboardWorker: Worker | null = null;

// Fixed lock duration that outlasts any realistic run. guardedSpawn resolves
// immediately after container start, so BullMQ holds the lock for mere seconds.
// Using a fixed 8-hour value prevents lock expiry for long-running containers.
const BULLMQ_LOCK_DURATION_MS = 8 * 60 * 60 * 1000;

/**
 * Guard that backpressures the dispatcher to the per-router concurrency cap
 * and classifies spawn errors for BullMQ retry policy (spec 015/2).
 *
 * Capacity miss: `acquireSlot` waits up to `slotWaitTimeoutMs` for a slot
 * to free; on timeout it rejects with `code: 'SLOT_WAIT_TIMEOUT'`, which
 * the classifier treats as transient so BullMQ retries via attempts/backoff.
 *
 * Spawn error: a transient error (Docker daemon unreachable, name collision
 * race, registry rate-limit) propagates unchanged — BullMQ retries. A
 * terminal error (validation, image-not-found-after-fallback) is wrapped in
 * `UnrecoverableError` so BullMQ skips the retry budget and the failed-event
 * compensator from spec 015/1 runs once at exhaustion.
 *
 * The slot is conceptually held by the running container, NOT by the
 * dispatcher — `slotReleased()` is called from `cleanupWorker` at container
 * exit, never from here.
 */
async function guardedSpawn(job: Job<CascadeJob>): Promise<void> {
	await acquireSlot({ timeoutMs: routerConfig.slotWaitTimeoutMs });
	try {
		await spawnWorker(job);
	} catch (err) {
		if (classifyDispatchError(err) === 'terminal') {
			throw new UnrecoverableError(err instanceof Error ? err.message : String(err));
		}
		throw err;
	}
}

/**
 * Dashboard-jobs processor. Most dashboard jobs (manual-run / retry-run /
 * debug-analysis) spawn a worker container via `guardedSpawn`. Two jobs are the
 * exception and run entirely router-side (they own the Docker socket) and must
 * NOT take a worker slot or spawn a container:
 *
 *   - `worker-image-validation` (spec 022): pull + inspect + smoke-test.
 *   - `worker-image-build` (spec 023): compose + build + pin + smoke-test.
 *
 * Both handlers are fail-closed and never throw, so BullMQ always sees the job
 * complete.
 */
async function processDashboardJob(job: Job): Promise<void> {
	const data = job.data as {
		type?: string;
		projectId?: string;
		ref?: string;
		buildHash?: string;
	};
	if (data?.type === 'worker-image-validation') {
		await handleWorkerImageValidation({
			projectId: String(data.projectId),
			ref: String(data.ref),
		});
		return;
	}
	if (data?.type === 'worker-image-build') {
		await handleWorkerImageBuild({
			projectId: String(data.projectId),
			buildHash: String(data.buildHash),
		});
		return;
	}
	await guardedSpawn(job as Job<CascadeJob>);
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
		lockDuration: BULLMQ_LOCK_DURATION_MS,
		processFn: guardedSpawn,
	});

	// Dashboard jobs queue — manual runs, retries, debug analyses submitted
	// from the dashboard API container.
	dashboardWorker = createQueueWorker({
		queueName: 'cascade-dashboard-jobs',
		label: 'Dashboard job',
		connection,
		concurrency: routerConfig.maxWorkers,
		lockDuration: BULLMQ_LOCK_DURATION_MS,
		processFn: (job) => processDashboardJob(job),
	});

	// Start periodic orphan cleanup scan
	startOrphanCleanup();

	// Start periodic snapshot eviction alongside orphan cleanup
	startSnapshotCleanup();

	// Start periodic dangling-image cleanup. Closes the leak class where
	// `commitWorkerSnapshot` re-tags `cascade-snapshot-*:latest` and
	// orphans the prior digest outside the snapshot registry. See
	// dangling-image-cleanup.ts for the safety scope.
	startDanglingImageCleanup();

	// Reconcile pre-existing snapshot images on disk so the eviction loop can
	// apply TTL/max-count/max-size policies to them. Best-effort — Docker
	// outage at boot must not block the worker manager from starting.
	void syncSnapshotsFromDocker().catch((err) => {
		logger.warn('[WorkerManager] Snapshot startup sync failed (continuing):', {
			error: String(err),
		});
	});

	logger.info('[WorkerManager] Started with max', routerConfig.maxWorkers, 'concurrent workers');
}

// Graceful shutdown — detach from workers, let them finish independently
export async function stopWorkerProcessor(): Promise<void> {
	// Stop orphan cleanup and snapshot cleanup first
	stopOrphanCleanup();
	stopSnapshotCleanup();
	stopDanglingImageCleanup();

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

	// Reject any pending slot waiters so they don't leak timers across the
	// shutdown. Spec 015/2.
	clearAllWaiters();

	logger.info('[WorkerManager] Stopped');
}
