/**
 * Large-job-payload offload to Redis.
 *
 * The router passes the full job payload to a worker container via the
 * `JOB_DATA` environment variable (`worker-env.ts`). Linux caps a single
 * argv/env string at `MAX_ARG_STRLEN` (128 KiB); when the serialized payload
 * exceeds it, the kernel rejects the `execve` of the container entrypoint with
 * `exec ...: argument list too long` and the worker dies in ~260ms before any
 * JS runs — silently breaking every agent run for that work item.
 *
 * This happened in prod on ucho/MNG-1660 (a Linear issue whose ~10KB+ markdown
 * description was serialized twice — once as the raw webhook `payload`, once
 * inside the pre-resolved `triggerResult.agentInput`). PM adapters MUST keep
 * embedding the pre-resolved `triggerResult` (MNG-1053 freshness-gate invariant),
 * so the fix is to move the payload OFF the env channel, not to shrink it.
 *
 * When `JSON.stringify(job.data)` exceeds `JOB_DATA_INLINE_MAX_BYTES`, the
 * router stores it in Redis under `cascade:jobdata:<jobId>` and passes
 * `JOB_DATA_REDIS_KEY` instead of `JOB_DATA`. The worker reads + deletes the
 * key on startup (see `worker-entry.ts`). Small payloads keep using the inline
 * env var (backward compatible).
 *
 * Redis is chosen over a bind-mounted file because the router runs as a
 * container and spawns sibling workers via the Docker socket: a Dockerode bind
 * path resolves on the docker host, not inside the router container, so a file
 * written by the router is not the file mounted into the worker without a
 * shared host volume. The worker already receives `REDIS_URL` and both
 * processes can reach the same Redis with zero infra change. Mirrors the
 * lazy-singleton pattern in `triggers/github/review-dispatch-dedup.ts`.
 */

import { Redis } from 'ioredis';
import { captureException } from '../sentry.js';
import { logger } from '../utils/logging.js';
import { routerConfig } from './config.js';

/**
 * Inline-vs-offload threshold, in bytes. 96 KiB leaves headroom under the
 * 128 KiB `MAX_ARG_STRLEN` per-string kernel limit (for the `JOB_DATA=` prefix
 * and any multibyte expansion). Measure with `Buffer.byteLength(..., 'utf8')`,
 * never `String.length`.
 */
export const JOB_DATA_INLINE_MAX_BYTES = 96 * 1024;

/**
 * TTL for an offloaded payload. The worker DELetes the key immediately after a
 * successful read, so this is only a safety net for the case where the worker
 * never starts (spawn failure / crash before read) — it bounds the leak.
 */
export const JOB_DATA_OFFLOAD_TTL_SEC = 60 * 60;

const KEY_NS = 'cascade:jobdata:';

let redisInstance: Redis | null = null;

/**
 * Lazy singleton. Reads the URL via `routerConfig.redisUrl` (captured at
 * config-module load) rather than `process.env.REDIS_URL`, because the worker
 * scrubs `REDIS_URL` from `process.env` early in startup (`scrubSensitiveEnv`).
 * The routerConfig snapshot survives the scrub, same as the DB pool's cached
 * connection string and `review-dispatch-dedup.ts`.
 */
function getRedis(): Redis {
	if (!redisInstance) {
		if (!routerConfig.redisUrl) {
			throw new Error('REDIS_URL is required for JOB_DATA offload');
		}
		redisInstance = new Redis(routerConfig.redisUrl);
	}
	return redisInstance;
}

export function buildJobDataRedisKey(jobId: string): string {
	return `${KEY_NS}${jobId}`;
}

/**
 * Store a serialized job payload in Redis. Throws loudly on failure so the
 * caller (`buildWorkerEnvWithProjectId` → `spawnWorker`) burns a BullMQ retry
 * instead of launching a container that is guaranteed to crash at exec.
 */
export async function offloadJobData(jobId: string, serialized: string): Promise<void> {
	const key = buildJobDataRedisKey(jobId);
	try {
		await getRedis().set(key, serialized, 'EX', JOB_DATA_OFFLOAD_TTL_SEC);
	} catch (err) {
		captureException(err, { tags: { source: 'job_data_offload_write' }, extra: { jobId } });
		throw new Error(`Failed to offload JOB_DATA to Redis for job ${jobId}: ${String(err)}`);
	}
}

/**
 * Read (and best-effort delete) an offloaded job payload. Throws a distinct,
 * grep-able error on a missing key or a Redis failure so the worker exits with
 * a clear reason — never the cryptic `argument list too long` exec crash.
 */
export async function readOffloadedJobData(key: string): Promise<string> {
	let value: string | null;
	try {
		value = await getRedis().get(key);
	} catch (err) {
		throw new Error(`Failed to read offloaded JOB_DATA from Redis (key ${key}): ${String(err)}`);
	}
	if (value === null) {
		throw new Error(`Offloaded JOB_DATA key ${key} not found in Redis (expired or never written)`);
	}
	// Best-effort cleanup — the TTL reaps the key if this fails.
	try {
		await getRedis().del(key);
	} catch (err) {
		logger.warn('[job-data-offload] Failed to delete offloaded JOB_DATA key (TTL will reap it)', {
			key,
			error: String(err),
		});
	}
	return value;
}
