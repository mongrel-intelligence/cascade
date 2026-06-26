/**
 * Unit tests for the worker-image-validation enqueue helper (spec 022 plan 3/4).
 *
 * Mirrors the structure of client.test.ts: mock bullmq's Queue, re-import the
 * module fresh per test so the lazy `queue` singleton is rebuilt.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockQueueAdd = vi.fn();
const mockQueueRemove = vi.fn();

vi.mock('bullmq', () => ({
	Queue: vi.fn().mockImplementation(() => ({
		add: mockQueueAdd,
		remove: mockQueueRemove,
	})),
}));

const mockParseRedisUrl = vi.fn().mockReturnValue({ host: 'localhost', port: 6379 });
vi.mock('../../../src/utils/redis.js', () => ({
	parseRedisUrl: (...args: unknown[]) => mockParseRedisUrl(...args),
}));

async function freshImport() {
	vi.resetModules();
	vi.mock('bullmq', () => ({
		Queue: vi.fn().mockImplementation(() => ({
			add: mockQueueAdd,
			remove: mockQueueRemove,
		})),
	}));
	vi.mock('../../../src/utils/redis.js', () => ({
		parseRedisUrl: (...args: unknown[]) => mockParseRedisUrl(...args),
	}));
	return import('../../../src/queue/client.js');
}

describe('workerImageValidationJobId', () => {
	afterEach(() => {
		vi.resetModules();
	});

	it('returns a deterministic id prefixed with worker-image-validation- per project', async () => {
		const { workerImageValidationJobId } = await freshImport();
		expect(workerImageValidationJobId('proj-1')).toBe('worker-image-validation-proj-1');
		expect(workerImageValidationJobId('proj-1')).toBe(workerImageValidationJobId('proj-1'));
	});
});

describe('enqueueWorkerImageValidationJob', () => {
	beforeEach(() => {
		vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
		mockQueueAdd.mockResolvedValue({ id: 'worker-image-validation-proj-1' });
		mockQueueRemove.mockResolvedValue(1);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	it('schedules a worker-image-validation job with the projectId + ref payload', async () => {
		const { enqueueWorkerImageValidationJob } = await freshImport();

		const result = await enqueueWorkerImageValidationJob({
			projectId: 'proj-1',
			ref: 'ghcr.io/acme/cascade-worker:latest',
		});

		expect(mockQueueAdd).toHaveBeenCalledWith(
			'worker-image-validation',
			{
				type: 'worker-image-validation',
				projectId: 'proj-1',
				ref: 'ghcr.io/acme/cascade-worker:latest',
			},
			{ jobId: 'worker-image-validation-proj-1' },
		);
		expect(result).toBe('worker-image-validation-proj-1');
	});

	it('removes any stale job for the project before enqueueing a fresh one', async () => {
		const { enqueueWorkerImageValidationJob } = await freshImport();

		await enqueueWorkerImageValidationJob({ projectId: 'proj-7', ref: 'cascade-worker:local' });

		expect(mockQueueRemove).toHaveBeenCalledWith('worker-image-validation-proj-7');
	});
});
