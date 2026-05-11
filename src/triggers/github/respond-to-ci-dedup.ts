/**
 * Respond-to-CI dispatch deduplication, Redis-backed.
 *
 * Guards against duplicate dispatch when a success-side deferred recheck fires
 * ~30 s after a failure handler has already dispatched respond-to-ci for the
 * same PR+SHA.  The failure handler (or the first success-side dispatch) claims
 * the slot; the recheck finds it taken and skips.
 *
 * Why Redis (and not a process-local Map):
 * The deferred recheck runs inside a *worker* container that starts with an
 * empty in-process Map — it has no memory of what the router process dispatched
 * 30 s earlier.  Only a shared external store bridges that gap.  Mirrors the
 * cross-process dedup rationale in `review-dispatch-dedup.ts`.
 *
 * Redis primitive: `SET key value NX EX <ttl>` — atomic check-and-set with
 * TTL.  Returns `'OK'` on first claim, `null` on duplicate.  No race window.
 *
 * Failure mode: when Redis is unreachable, `claim` returns `false` (treats
 * the call as a duplicate) and Sentry-captures under
 * `respond_to_ci_dedup_redis_down`.  Better to skip a legit dispatch than to
 * launch duplicate fix agents; mirrors spec-017's fail-closed posture.
 */

import { Redis } from 'ioredis';
import { routerConfig } from '../../router/config.js';
import { captureException } from '../../sentry.js';
import { logger } from '../../utils/logging.js';

// 35 minutes — must cover the full duplicate window: 30 s deferred-recheck
// delay + up to 5 min waiting for a worker slot (slotWaitTimeoutMs default)
// + up to 30 min of active worker execution (workerTimeoutMs default) + buffer.
//
// The critical scenario this prevents:
//   1. Failure webhook fires → key claimed → respond-to-ci dispatched (starts running).
//   2. Success-side deferred recheck fires 30 s later → key taken → skips. ✓
//   3. respond-to-ci worker runs for e.g. 25 min.
//   4. With a 10-min TTL, the key has already expired by now.
//   5. A second delayed check-suite recheck fires → key NOT taken → would
//      dispatch ANOTHER fix agent for the same PR+SHA. ✗
//
// By setting the TTL to 35 min (30-min workerTimeoutMs + 5-min buffer), the key
// stays alive for the entire execution window of the original respond-to-ci job.
// After that job exits and the work-item lock is released, the next legitimate
// trigger can go through the router's own lock mechanism.
//
// Matches the work-item lock TTL (30 min, src/router/work-item-lock.ts) so the
// two mechanisms age out together.
const DEDUP_TTL_SEC = 35 * 60;

const KEY_NS = 'cascade:respond-to-ci-dedup:';

let redisInstance: Redis | null = null;

/**
 * Lazy singleton — first call connects, subsequent calls reuse the same
 * client.  Reads `routerConfig.redisUrl` (captured at config.ts module load)
 * rather than `process.env.REDIS_URL` so the URL survives `scrubSensitiveEnv()`
 * in worker containers.
 */
function getRedis(): Redis {
	if (!redisInstance) {
		if (!routerConfig.redisUrl) {
			throw new Error('REDIS_URL is required for respond-to-ci-dispatch dedup');
		}
		redisInstance = new Redis(routerConfig.redisUrl);
	}
	return redisInstance;
}

export function buildRespondToCiDispatchKey(
	owner: string,
	repo: string,
	prNumber: number,
	headSha: string,
): string {
	return `${owner}/${repo}:${prNumber}:${headSha}`;
}

/**
 * Atomically claim a dispatch slot for the given key.  Returns `true` exactly
 * once per key within the TTL window across ALL connected processes.
 *
 * Fails closed on Redis errors: returns `false` so the caller skips the
 * dispatch.  Sentry-captures under `respond_to_ci_dedup_redis_down`.
 */
export async function claimRespondToCiDispatch(
	key: string,
	triggerName: string,
	context: { prNumber: number; headSha: string },
): Promise<boolean> {
	const namespacedKey = `${KEY_NS}${key}`;
	try {
		const result = await getRedis().set(namespacedKey, triggerName, 'EX', DEDUP_TTL_SEC, 'NX');
		if (result === 'OK') {
			logger.info('Claimed respond-to-ci dispatch for PR+SHA', {
				trigger: triggerName,
				respondToCiDispatchKey: key,
				prNumber: context.prNumber,
				headSha: context.headSha,
			});
			return true;
		}
		logger.info('Respond-to-ci already dispatched for this PR+SHA, skipping', {
			trigger: triggerName,
			respondToCiDispatchKey: key,
			prNumber: context.prNumber,
			headSha: context.headSha,
		});
		return false;
	} catch (err) {
		logger.error('Respond-to-ci dedup Redis call failed — failing closed', {
			trigger: triggerName,
			respondToCiDispatchKey: key,
			error: String(err),
		});
		captureException(err, {
			tags: { source: 'respond_to_ci_dedup_redis_down' },
			extra: { respondToCiDispatchKey: key, trigger: triggerName },
			level: 'error',
		});
		return false;
	}
}

/**
 * Release a previously-claimed dispatch slot.  Used by `onBlocked` callbacks
 * when downstream rejects the dispatch (work-item lock, agent-type concurrency,
 * etc.) so the next legitimate trigger can claim.
 *
 * Errors are logged but never thrown — release is best-effort, and the TTL
 * is the safety net.
 */
export async function releaseRespondToCiDispatch(key: string): Promise<void> {
	const namespacedKey = `${KEY_NS}${key}`;
	try {
		await getRedis().del(namespacedKey);
	} catch (err) {
		logger.warn('Respond-to-ci dedup release failed (TTL will reap)', {
			respondToCiDispatchKey: key,
			error: String(err),
		});
	}
}

/**
 * Test-only: flush the dedup namespace and reset the singleton.  Intended for
 * `beforeEach` in unit tests and for the integration suite's per-test cleanup.
 * Never call from production code.
 *
 * @internal
 */
export async function __resetForTests(): Promise<void> {
	if (!redisInstance) return;
	const keys = await redisInstance.keys(`${KEY_NS}*`);
	if (keys.length > 0) await redisInstance.del(...keys);
	await redisInstance.quit().catch(() => {});
	redisInstance = null;
}
