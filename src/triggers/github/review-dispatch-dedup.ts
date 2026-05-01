/**
 * Review-dispatch deduplication, Redis-backed.
 *
 * `claimReviewDispatch(key, ...)` returns `true` exactly once per key within
 * the TTL window — across ALL processes that share the same Redis backend.
 * Subsequent calls (from the same or any other process) return `false` and
 * the caller must skip the dispatch.
 *
 * Why Redis (and not the in-memory Map this module used to be):
 * the dedup key (`owner/repo:prNumber:headSha`) is claimed from at least
 * THREE distinct processes:
 *   1. Router process — `check-suite-success` and `review-requested` triggers.
 *   2. IMPL worker process — `agent-execution.ts` post-completion-hook
 *      (fires the review immediately after impl completes, regardless of
 *      whether GitHub eventually delivers the check_suite-success event).
 *   3. Future router replicas / horizontally-scaled deployments.
 *
 * The pre-Redis Map was module-scoped and per-process: each process started
 * with an empty Map, so the dedup never crossed process boundaries.
 * Production confirmed live duplicate dispatch on ucho/PR #194 (2026-05-01) —
 * post-completion-hook (worker) and check-suite-success (router) BOTH
 * dispatched a review for the same SHA, both claimed `true` from their own
 * empty Map, both burned LLM tokens. See PR #1248 for the diagnosis.
 *
 * Redis primitive: `SET key value NX EX <ttl>` — atomic check-and-set with
 * TTL. Returns `'OK'` on first claim, `null` on duplicate. No race window.
 *
 * Failure mode: when Redis is unreachable, `claim` returns `false` (treats
 * the call as a duplicate) and Sentry-captures under `review_dedup_redis_down`.
 * Better to skip a legit dispatch than to dispatch a duplicate; mirrors
 * spec-017's fail-closed pipeline-capacity-gate posture.
 */

import { Redis } from 'ioredis';
import { routerConfig } from '../../router/config.js';
import { captureException } from '../../sentry.js';
import { logger } from '../../utils/logging.js';

// 5 minutes — kept short because dispatches now correlate with actually-
// running workers (post the PR #1246 defer-on-incomplete refactor); a longer
// TTL has no defensive value and amplifies any wedged-state incident.
const DEDUP_TTL_SEC = 5 * 60;

const KEY_NS = 'cascade:review-dedup:';

let redisInstance: Redis | null = null;

/**
 * Lazy singleton — first call connects, subsequent calls reuse the same
 * client. The worker process pays the connection cost only if it actually
 * dispatches a review (post-completion-hook).
 *
 * Reads the URL via `routerConfig.redisUrl` (captured at config.ts module
 * load) rather than `process.env.REDIS_URL`. Worker processes call
 * `scrubSensitiveEnv()` early in startup, which deletes `REDIS_URL` from
 * `process.env`; reading lazily would see `undefined` and throw. The
 * routerConfig snapshot survives the scrub the same way the DB pool's
 * cached connection string does.
 */
function getRedis(): Redis {
	if (!redisInstance) {
		if (!routerConfig.redisUrl) {
			throw new Error('REDIS_URL is required for review-dispatch dedup');
		}
		redisInstance = new Redis(routerConfig.redisUrl);
	}
	return redisInstance;
}

export function buildReviewDispatchKey(
	owner: string,
	repo: string,
	prNumber: number,
	headSha: string,
): string {
	return `${owner}/${repo}:${prNumber}:${headSha}`;
}

/**
 * Atomically claim a dispatch slot for the given key. Returns `true` exactly
 * once per key within the TTL window across ALL connected processes.
 *
 * Fails closed on Redis errors: returns `false` so the caller skips the
 * dispatch. Sentry-captures the underlying error under
 * `review_dedup_redis_down`.
 */
export async function claimReviewDispatch(
	key: string,
	triggerName: string,
	context: { prNumber: number; headSha: string },
): Promise<boolean> {
	const namespacedKey = `${KEY_NS}${key}`;
	try {
		const result = await getRedis().set(namespacedKey, triggerName, 'EX', DEDUP_TTL_SEC, 'NX');
		if (result === 'OK') {
			logger.info('Claimed review dispatch for PR+SHA', {
				trigger: triggerName,
				reviewDispatchKey: key,
				prNumber: context.prNumber,
				headSha: context.headSha,
			});
			return true;
		}
		logger.info('Review already dispatched for this PR+SHA, skipping', {
			trigger: triggerName,
			reviewDispatchKey: key,
			prNumber: context.prNumber,
			headSha: context.headSha,
		});
		return false;
	} catch (err) {
		logger.error('Review-dispatch dedup Redis call failed — failing closed', {
			trigger: triggerName,
			reviewDispatchKey: key,
			error: String(err),
		});
		captureException(err, {
			tags: { source: 'review_dedup_redis_down' },
			extra: { reviewDispatchKey: key, trigger: triggerName },
			level: 'error',
		});
		return false;
	}
}

/**
 * Release a previously-claimed dispatch slot. Used by `onBlocked` callbacks
 * when downstream rejects the dispatch (work-item lock, agent-type
 * concurrency, etc.) so the next legitimate trigger can claim.
 *
 * Errors are logged but never thrown — release is best-effort, and the TTL
 * is the safety net.
 */
export async function releaseReviewDispatch(key: string): Promise<void> {
	const namespacedKey = `${KEY_NS}${key}`;
	try {
		await getRedis().del(namespacedKey);
	} catch (err) {
		logger.warn('Review-dispatch dedup release failed (TTL will reap)', {
			reviewDispatchKey: key,
			error: String(err),
		});
	}
}

/**
 * Test-only: flush the dedup namespace and reset the singleton. Intended for
 * `beforeEach` in unit tests and for the integration suite's per-test
 * cleanup. Never call from production code.
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
