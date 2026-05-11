/**
 * Dispatch-error classifier (spec 015/2).
 *
 * Decide whether a thrown error from `spawnWorker` / `acquireSlot`
 * should burn a BullMQ retry attempt (`'transient'`) or skip retries
 * by being wrapped in `UnrecoverableError` (`'terminal'`).
 *
 * Default is `'transient'` — when in doubt, retry. The retry budget
 * itself is bounded (4 attempts with exponential backoff), so a true
 * bug can't loop forever; it will surface via attempt exhaustion +
 * Sentry capture in the failed-event hook.
 *
 * Recognized terminal classes:
 *  - validation errors (TypeError, ZodError)
 *  - image-not-found AFTER the fallback retry has already exhausted
 *
 * Recognized transient classes:
 *  - ECONNREFUSED / ECONNRESET / ENOTFOUND on the Docker socket
 *  - HTTP 429 from the registry (rate limit)
 *  - HTTP 409 "name already in use" (container-name collision race)
 *  - SLOT_WAIT_TIMEOUT from the slot-waiter primitive
 */

import { isImageNotFoundError } from './worker-snapshots.js';

export type DispatchErrorKind = 'transient' | 'terminal';

interface ErrorWithCode {
	code?: unknown;
	statusCode?: unknown;
	name?: unknown;
	message?: unknown;
}

const TRANSIENT_NODE_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT']);
const TRANSIENT_SLOT_CODES = new Set(['SLOT_WAIT_TIMEOUT']);
const TRANSIENT_HTTP_STATUS = new Set([429, 409]);

export function classifyDispatchError(err: unknown): DispatchErrorKind {
	if (err == null || typeof err !== 'object') return 'transient';

	const e = err as ErrorWithCode;

	// Terminal: validation
	if (e.name === 'ZodError') return 'terminal';
	if (err instanceof TypeError) return 'terminal';

	// Terminal: image-not-found AFTER fallback (the spawnWorker path's last
	// resort already retried with the base image; if we still got here, the
	// base image is genuinely missing).
	if (isImageNotFoundError(err)) return 'terminal';

	// Transient: tagged slot-wait timeout
	if (typeof e.code === 'string' && TRANSIENT_SLOT_CODES.has(e.code)) return 'transient';

	// Transient: socket-level Node errors
	if (typeof e.code === 'string' && TRANSIENT_NODE_CODES.has(e.code)) return 'transient';

	// Transient: known transient HTTP statuses
	if (typeof e.statusCode === 'number' && TRANSIENT_HTTP_STATUS.has(e.statusCode))
		return 'transient';

	// Default-to-retry: unknown shape. Better to burn a retry than to
	// silently bury a real bug as terminal — the retry budget caps risk.
	return 'transient';
}
