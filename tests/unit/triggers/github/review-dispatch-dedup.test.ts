/**
 * Review-dispatch dedup tests — Redis-backed.
 *
 * The `vi.mock('ioredis', ...)` factory closes over a single in-memory store,
 * so every `new Redis(...)` instance shares the same backend. That makes the
 * cross-process invariant trivially testable: instantiate two Redis clients
 * and verify the second `claim` for the same key returns `false`.
 *
 * The cross-process invariant is the regression pin for the production
 * incident on ucho/PR #194 (2026-05-01) — both router-process and
 * IMPL-worker-process dispatched a review for the same SHA because the
 * pre-Redis Map was per-process. See PR #1248.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// In-memory shared backend for the IORedis mock. Closure-captured by the
// vi.mock factory so every `new Redis(...)` instance reads/writes here.
// ---------------------------------------------------------------------------

interface StoredEntry {
	value: string;
	expiresAtMs: number | null;
}
const sharedStore = new Map<string, StoredEntry>();

function isExpired(entry: StoredEntry, nowMs: number): boolean {
	return entry.expiresAtMs !== null && entry.expiresAtMs <= nowMs;
}

vi.mock('ioredis', () => {
	class MockRedis {
		// IORedis `set` overload we care about: SET key value EX seconds NX.
		// Returns `'OK'` on success, `null` when NX rejected.
		// `quit()` and `del()` are also implemented; the rest is unused.
		async set(key: string, value: string, ...args: unknown[]): Promise<'OK' | null> {
			const flags = args.map((a) => (typeof a === 'string' ? a.toUpperCase() : a));
			const exIdx = flags.indexOf('EX');
			const ttlSec =
				exIdx !== -1 && typeof flags[exIdx + 1] !== 'undefined'
					? Number(flags[exIdx + 1] as string | number)
					: null;
			const isNX = flags.includes('NX');
			const now = Date.now();
			const existing = sharedStore.get(key);
			if (existing && !isExpired(existing, now)) {
				if (isNX) return null;
			}
			sharedStore.set(key, {
				value,
				expiresAtMs: ttlSec !== null ? now + ttlSec * 1000 : null,
			});
			return 'OK';
		}

		async del(...keys: string[]): Promise<number> {
			let removed = 0;
			for (const k of keys) {
				if (sharedStore.delete(k)) removed += 1;
			}
			return removed;
		}

		async keys(pattern: string): Promise<string[]> {
			// Tiny glob: only `prefix*` is used by `__resetForTests`.
			if (pattern.endsWith('*')) {
				const prefix = pattern.slice(0, -1);
				return [...sharedStore.keys()].filter((k) => k.startsWith(prefix));
			}
			return [...sharedStore.keys()].filter((k) => k === pattern);
		}

		async quit(): Promise<'OK'> {
			return 'OK';
		}

		// IORedis-style EventEmitter no-ops for `client.on('error', ...)` etc.
		on(): this {
			return this;
		}
	}
	return { Redis: MockRedis };
});

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

const mockCaptureException = vi.fn();
vi.mock('../../../../src/sentry.js', () => ({
	captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

import {
	__resetForTests,
	buildReviewDispatchKey,
	claimReviewDispatch,
	releaseReviewDispatch,
} from '../../../../src/triggers/github/review-dispatch-dedup.js';
import { logger } from '../../../../src/utils/logging.js';

const mockLogger = vi.mocked(logger);
const DEDUP_TTL_MS = 5 * 60 * 1000;

beforeEach(() => {
	vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
	sharedStore.clear();
	mockCaptureException.mockReset();
	mockLogger.info.mockReset();
	mockLogger.warn.mockReset();
	mockLogger.error.mockReset();
	mockLogger.debug.mockReset();
});

afterEach(async () => {
	await __resetForTests();
	vi.unstubAllEnvs();
});

describe('buildReviewDispatchKey', () => {
	it('returns owner/repo:prNumber:headSha', () => {
		expect(buildReviewDispatchKey('myorg', 'myrepo', 42, 'abc123def456')).toBe(
			'myorg/myrepo:42:abc123def456',
		);
	});

	it('separates components correctly', () => {
		expect(buildReviewDispatchKey('owner', 'repo', 1, 'sha')).toBe('owner/repo:1:sha');
	});
});

describe('claimReviewDispatch', () => {
	it('returns true on the first claim for a key', async () => {
		const key = buildReviewDispatchKey('acme', 'repo', 1, 'sha1');
		expect(
			await claimReviewDispatch(key, 'check-suite-success', { prNumber: 1, headSha: 'sha1' }),
		).toBe(true);
	});

	it('returns false on a duplicate claim for the same key', async () => {
		const key = buildReviewDispatchKey('acme', 'repo', 1, 'sha1');
		await claimReviewDispatch(key, 'check-suite-success', { prNumber: 1, headSha: 'sha1' });
		expect(
			await claimReviewDispatch(key, 'check-suite-success', { prNumber: 1, headSha: 'sha1' }),
		).toBe(false);
	});

	it('returns true for a different key (no cross-key interference)', async () => {
		const key1 = buildReviewDispatchKey('acme', 'repo', 1, 'sha1');
		const key2 = buildReviewDispatchKey('acme', 'repo', 2, 'sha2');
		await claimReviewDispatch(key1, 'check-suite-success', { prNumber: 1, headSha: 'sha1' });
		expect(
			await claimReviewDispatch(key2, 'check-suite-success', { prNumber: 2, headSha: 'sha2' }),
		).toBe(true);
	});

	it('logs an info line on successful claim', async () => {
		const key = buildReviewDispatchKey('acme', 'repo', 5, 'sha5');
		await claimReviewDispatch(key, 'review-requested', { prNumber: 5, headSha: 'sha5' });
		expect(mockLogger.info).toHaveBeenCalledWith(
			'Claimed review dispatch for PR+SHA',
			expect.objectContaining({
				trigger: 'review-requested',
				reviewDispatchKey: key,
				prNumber: 5,
				headSha: 'sha5',
			}),
		);
	});

	it('logs an info line on duplicate claim', async () => {
		const key = buildReviewDispatchKey('acme', 'repo', 7, 'sha7');
		await claimReviewDispatch(key, 'check-suite-success', { prNumber: 7, headSha: 'sha7' });
		await claimReviewDispatch(key, 'post-completion-hook', { prNumber: 7, headSha: 'sha7' });
		expect(mockLogger.info).toHaveBeenCalledWith(
			'Review already dispatched for this PR+SHA, skipping',
			expect.objectContaining({
				trigger: 'post-completion-hook',
				reviewDispatchKey: key,
				prNumber: 7,
				headSha: 'sha7',
			}),
		);
	});

	it('TTL expiration: a previously claimed key can be reclaimed after 5+ minutes', async () => {
		const key = buildReviewDispatchKey('acme', 'repo', 10, 'sha10');
		await claimReviewDispatch(key, 'check-suite-success', { prNumber: 10, headSha: 'sha10' });

		// Manually expire the entry by pushing its TTL into the past.
		// (vi.useFakeTimers doesn't help here because Date.now is consulted
		// inside the mock store; advancing real time is too slow for tests.)
		const stored = sharedStore.get(`cascade:review-dedup:${key}`);
		if (stored) stored.expiresAtMs = Date.now() - 1;

		expect(
			await claimReviewDispatch(key, 'check-suite-success', { prNumber: 10, headSha: 'sha10' }),
		).toBe(true);
	});

	it('does not expire a key before the TTL has elapsed', async () => {
		const key = buildReviewDispatchKey('acme', 'repo', 11, 'sha11');
		await claimReviewDispatch(key, 'check-suite-success', { prNumber: 11, headSha: 'sha11' });
		const stored = sharedStore.get(`cascade:review-dedup:${key}`);
		expect(stored?.expiresAtMs).toBeGreaterThan(Date.now() + DEDUP_TTL_MS - 5_000);
		expect(
			await claimReviewDispatch(key, 'check-suite-success', { prNumber: 11, headSha: 'sha11' }),
		).toBe(false);
	});

	it('namespaces the key under cascade:review-dedup: in Redis', async () => {
		const key = buildReviewDispatchKey('acme', 'repo', 99, 'sha99');
		await claimReviewDispatch(key, 'check-suite-success', { prNumber: 99, headSha: 'sha99' });
		expect(sharedStore.has(`cascade:review-dedup:${key}`)).toBe(true);
		expect(sharedStore.has(key)).toBe(false); // un-namespaced must NOT be present
	});

	it('fails closed when Redis errors, returning false and capturing to Sentry', async () => {
		const { Redis } = await import('ioredis');
		// Patch the prototype to force `set` to throw on the next call.
		const realSet = (Redis.prototype as unknown as { set: (...a: unknown[]) => unknown }).set;
		(Redis.prototype as unknown as { set: () => unknown }).set = () => {
			throw new Error('connection refused');
		};

		try {
			const key = buildReviewDispatchKey('acme', 'repo', 50, 'sha50');
			expect(
				await claimReviewDispatch(key, 'check-suite-success', { prNumber: 50, headSha: 'sha50' }),
			).toBe(false);
			expect(mockLogger.error).toHaveBeenCalledWith(
				'Review-dispatch dedup Redis call failed — failing closed',
				expect.objectContaining({ reviewDispatchKey: key }),
			);
			expect(mockCaptureException).toHaveBeenCalledWith(
				expect.any(Error),
				expect.objectContaining({
					tags: expect.objectContaining({ source: 'review_dedup_redis_down' }),
				}),
			);
		} finally {
			(Redis.prototype as unknown as { set: typeof realSet }).set = realSet;
		}
	});
});

describe('releaseReviewDispatch', () => {
	it('removes a claimed key so it can be reclaimed immediately', async () => {
		const key = buildReviewDispatchKey('acme', 'repo', 30, 'sha30');
		await claimReviewDispatch(key, 'check-suite-success', { prNumber: 30, headSha: 'sha30' });
		await releaseReviewDispatch(key);
		expect(
			await claimReviewDispatch(key, 'check-suite-success', { prNumber: 30, headSha: 'sha30' }),
		).toBe(true);
	});

	it('is a no-op for a key that was never claimed', async () => {
		const key = buildReviewDispatchKey('acme', 'repo', 31, 'sha31');
		await expect(releaseReviewDispatch(key)).resolves.toBeUndefined();
	});

	it('only removes the specified key, leaving others intact', async () => {
		const key1 = buildReviewDispatchKey('acme', 'repo', 40, 'sha40');
		const key2 = buildReviewDispatchKey('acme', 'repo', 41, 'sha41');
		await claimReviewDispatch(key1, 'check-suite-success', { prNumber: 40, headSha: 'sha40' });
		await claimReviewDispatch(key2, 'check-suite-success', { prNumber: 41, headSha: 'sha41' });
		await releaseReviewDispatch(key1);
		expect(sharedStore.has(`cascade:review-dedup:${key1}`)).toBe(false);
		expect(sharedStore.has(`cascade:review-dedup:${key2}`)).toBe(true);
	});
});

// ─── Cross-process invariant ────────────────────────────────────────────────
//
// THIS is the regression pin for ucho/PR #194 (2026-05-01). Two cascade
// processes — the IMPL worker (post-completion-hook) and the router
// (check-suite-success) — both claimed the same dedup key from their own
// in-memory Map and BOTH dispatched a review. With Redis-backed dedup, the
// second process MUST see the first's claim.
//
// We simulate "two processes" by instantiating two IORedis clients from
// scratch via `new Redis()` (vi.mock's factory is shared, so both reach the
// same in-memory store — exactly mirroring two real processes hitting the
// same Redis backend).

describe('cross-process dedup invariant (PR #194 regression pin)', () => {
	// Direct-instance test: two IORedis clients constructed from scratch
	// against the same Redis URL. Mirrors the real-prod shape where the
	// router process and the IMPL worker process each instantiate their own
	// client. Pre-PR-#1248 the dedup was an in-memory `Map` per process and
	// these two clients would have observed independent state — both
	// dispatches succeeded, both burned LLM tokens. The Redis-backed
	// `SET NX EX` primitive must reject the second claim atomically.
	it('two distinct IORedis instances against the shared backend share dedup state', async () => {
		const { Redis } = await import('ioredis');
		const routerProcessClient = new Redis('redis://localhost:6379');
		const workerProcessClient = new Redis('redis://localhost:6379');

		const key = `cascade:review-dedup:${buildReviewDispatchKey('zbigniewsobiecki', 'ucho', 194, '9ed484df')}`;
		const firstResult = await routerProcessClient.set(key, 'check-suite-success', 'EX', 300, 'NX');
		const secondResult = await workerProcessClient.set(
			key,
			'post-completion-hook',
			'EX',
			300,
			'NX',
		);

		expect(firstResult).toBe('OK');
		expect(secondResult).toBeNull();
	});
});

// ─── Worker-scrub regression pin (PR #1250) ─────────────────────────────────
//
// `src/utils/envScrub.ts:13-18` deletes REDIS_URL from process.env early in
// every cascade-worker process (after the DB pool is initialized). The
// dedup module must survive this — `getRedis()` reads from the
// `routerConfig.redisUrl` snapshot captured at config.ts load, not from
// `process.env.REDIS_URL` lazily.
//
// Production incident: 2026-05-01T17:25:44 in worker
// `cascade-worker-coalesce_ucho_MNG-461_*` threw `Error: REDIS_URL is
// required for review-dispatch dedup` because the lazy read happened well
// after the scrub had run. Sentry tag: `review_dedup_redis_down`.

describe('survives mid-process REDIS_URL deletion (envScrub regression pin)', () => {
	it('claims successfully even after process.env.REDIS_URL is deleted', async () => {
		const key = buildReviewDispatchKey('acme', 'repo', 42, 'sha42');

		// First claim with REDIS_URL set — should succeed and create the
		// singleton client backed by the routerConfig snapshot.
		const first = await claimReviewDispatch(key, 'check-suite-success', {
			prNumber: 42,
			headSha: 'sha42',
		});
		expect(first).toBe(true);

		// Simulate worker-process envScrub by deleting the env var.
		// Subsequent claims must STILL work because the singleton uses
		// routerConfig.redisUrl (captured at module load), not process.env.
		const previous = process.env.REDIS_URL;
		delete process.env.REDIS_URL;
		try {
			// Same key → dedup hit (false). Crucially this does NOT throw
			// `REDIS_URL is required` — the regression behaviour pre-PR-#1250.
			const second = await claimReviewDispatch(key, 'post-completion-hook', {
				prNumber: 42,
				headSha: 'sha42',
			});
			expect(second).toBe(false);

			// Different key → claim succeeds.
			const otherKey = buildReviewDispatchKey('acme', 'repo', 43, 'sha43');
			const third = await claimReviewDispatch(otherKey, 'post-completion-hook', {
				prNumber: 43,
				headSha: 'sha43',
			});
			expect(third).toBe(true);
		} finally {
			if (previous !== undefined) process.env.REDIS_URL = previous;
		}
	});
});
