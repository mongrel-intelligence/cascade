import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Direct regression for the MNG-1660 class: a job payload larger than the OS
 * MAX_ARG_STRLEN (128 KiB) must NOT appear inline in any worker env string, and
 * must round-trip losslessly through the Redis offload (router write → worker
 * read). Uses the REAL job-data-offload module against an in-memory Redis — no
 * Docker, no live Redis.
 */

// In-memory Redis shared by the router-write and worker-read paths.
const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }));

vi.mock('ioredis', () => ({
	Redis: vi.fn().mockImplementation(() => ({
		set: async (k: string, v: string) => {
			store.set(k, v);
			return 'OK';
		},
		get: async (k: string) => store.get(k) ?? null,
		del: async (k: string) => {
			store.delete(k);
			return 1;
		},
	})),
}));

vi.mock('../../../src/router/config.js', () => ({
	routerConfig: { redisUrl: 'redis://localhost:6379', workerImage: 'test-worker:latest' },
}));

vi.mock('../../../src/sentry.js', () => ({ captureException: vi.fn() }));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../src/config/provider.js', () => ({
	findProjectByRepo: vi.fn(),
	getAllProjectCredentials: vi.fn().mockResolvedValue({}),
}));

import {
	JOB_DATA_INLINE_MAX_BYTES,
	readOffloadedJobData,
} from '../../../src/router/job-data-offload.js';
import type { CascadeJob } from '../../../src/router/queue.js';
import { buildWorkerEnvWithProjectId } from '../../../src/router/worker-env.js';

beforeEach(() => {
	store.clear();
});

describe('large JOB_DATA round-trip (router write → worker read)', () => {
	it('keeps the oversized payload off the env channel and restores it losslessly', async () => {
		// ~200 KB description — comfortably over the 128 KiB kernel arg limit.
		const jobData = {
			type: 'linear',
			source: 'linear',
			payload: { type: 'Issue', data: { id: 'lin-1', description: 'a'.repeat(200 * 1024) } },
			projectId: 'proj-1',
			workItemId: 'lin-1',
			eventType: 'update/Issue',
			receivedAt: '2024-01-01T00:00:00Z',
			triggerResult: { agentType: 'implementation', workItemId: 'MNG-1660' },
		} as unknown as CascadeJob;

		const job = { id: 'coalesce_ucho_MNG-1660_123_abc', data: jobData };

		const env = await buildWorkerEnvWithProjectId(job as never, 'proj-1');

		// 1. The payload was offloaded, not inlined.
		expect(env.some((e) => e.startsWith('JOB_DATA='))).toBe(false);
		const keyEntry = env.find((e) => e.startsWith('JOB_DATA_REDIS_KEY='));
		expect(keyEntry).toBeDefined();

		// 2. No single env string exceeds the inline limit — the exec crash is impossible.
		for (const e of env) {
			expect(Buffer.byteLength(e, 'utf8')).toBeLessThanOrEqual(JOB_DATA_INLINE_MAX_BYTES);
		}

		// 3. The worker read path restores the exact original job.data.
		const key = keyEntry?.slice('JOB_DATA_REDIS_KEY='.length) as string;
		const restored = JSON.parse(await readOffloadedJobData(key));
		expect(restored).toEqual(jobData);

		// 4. Worker DELetes the key after reading (no leak beyond the read).
		expect(store.has(key)).toBe(false);
	});
});
