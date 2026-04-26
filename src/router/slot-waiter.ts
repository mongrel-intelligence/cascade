/**
 * In-process slot waiter — semaphore-style backpressure for the dispatcher.
 *
 * Replaces the old "throw on capacity" pattern from spec 015/2. When the
 * dispatcher pulls a job and the worker pool is already at `maxWorkers`,
 * the dispatcher awaits a slot up to a bounded timeout. If a slot frees
 * (because a running container exits and `cleanupWorker` calls
 * `slotReleased`), the waiter resolves and the job dispatches normally.
 * If the timeout fires, the waiter rejects with a tagged
 * `code: 'SLOT_WAIT_TIMEOUT'` error — the dispatch-error classifier
 * recognises this code as transient, so BullMQ's retry budget kicks in.
 *
 * The slot is conceptually held by the running container, NOT by the
 * dispatcher. `slotReleased()` is called once per cleanup from
 * `cleanupWorker` (see spec 015/2 plan). The dispatcher does NOT call it.
 */

import { logger } from '../utils/logging.js';
import { getActiveWorkerCount } from './active-workers.js';
import { routerConfig } from './config.js';

interface PendingWaiter {
	resolve: () => void;
	reject: (err: Error) => void;
	timeoutHandle: NodeJS.Timeout;
}

const pending: PendingWaiter[] = [];

/**
 * Wait until the worker pool has capacity, or the timeout fires.
 *
 * If `getActiveWorkerCount() < routerConfig.maxWorkers`, resolves
 * immediately. Otherwise queues a waiter that the next `slotReleased()`
 * call will pop. If the waiter sits longer than `timeoutMs`, it rejects
 * with `code: 'SLOT_WAIT_TIMEOUT'`.
 */
export function acquireSlot(opts: { timeoutMs: number }): Promise<void> {
	if (getActiveWorkerCount() < routerConfig.maxWorkers) {
		return Promise.resolve();
	}

	return new Promise<void>((resolve, reject) => {
		const entry: PendingWaiter = {
			resolve,
			reject,
			timeoutHandle: setTimeout(() => {
				const idx = pending.indexOf(entry);
				if (idx >= 0) pending.splice(idx, 1);
				const err = new Error(
					`Slot wait timed out after ${opts.timeoutMs}ms — worker pool stuck`,
				) as Error & { code: string };
				err.code = 'SLOT_WAIT_TIMEOUT';
				logger.warn('[slot-waiter] timed out', { timeoutMs: opts.timeoutMs });
				reject(err);
			}, opts.timeoutMs),
		};
		pending.push(entry);
	});
}

/**
 * Pop the head waiter and resolve it. No-op if the queue is empty —
 * called every time a worker container exits, regardless of whether
 * any dispatcher is currently waiting.
 */
export function slotReleased(): void {
	const next = pending.shift();
	if (!next) return;
	clearTimeout(next.timeoutHandle);
	next.resolve();
}

/**
 * Reject every pending waiter with `code: 'SHUTDOWN'`. Called on
 * router shutdown / detachAll to avoid leaking timers and to surface
 * a clear error to in-flight dispatchers.
 */
export function clearAllWaiters(): void {
	while (pending.length > 0) {
		const entry = pending.shift();
		if (!entry) break;
		clearTimeout(entry.timeoutHandle);
		const err = new Error('slot-waiter: shutdown') as Error & { code: string };
		err.code = 'SHUTDOWN';
		entry.reject(err);
	}
}
