/**
 * Unit tests for the worker-image-build enqueue helper (spec 023 plan 3/5).
 *
 * Mirrors worker-image-validation-job.test.ts: mock bullmq's Queue, re-import the
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

describe('workerImageBuildJobId', () => {
	afterEach(() => {
		vi.resetModules();
	});

	it('returns a deterministic id prefixed with worker-image-build- per project', async () => {
		const { workerImageBuildJobId } = await freshImport();
		expect(workerImageBuildJobId('proj-1')).toBe('worker-image-build-proj-1');
		expect(workerImageBuildJobId('proj-1')).toBe(workerImageBuildJobId('proj-1'));
	});

	it('is distinct from the validation job id for the same project', async () => {
		const { workerImageBuildJobId, workerImageValidationJobId } = await freshImport();
		expect(workerImageBuildJobId('proj-1')).not.toBe(workerImageValidationJobId('proj-1'));
	});
});

describe('enqueueWorkerImageBuildJob', () => {
	beforeEach(() => {
		vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
		mockQueueAdd.mockResolvedValue({ id: 'worker-image-build-proj-1' });
		mockQueueRemove.mockResolvedValue(1);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	it('schedules a worker-image-build job with the projectId + buildHash payload', async () => {
		const { enqueueWorkerImageBuildJob } = await freshImport();

		const result = await enqueueWorkerImageBuildJob({
			projectId: 'proj-1',
			buildHash: 'sha256-content-hash',
		});

		expect(mockQueueAdd).toHaveBeenCalledWith(
			'worker-image-build',
			{
				type: 'worker-image-build',
				projectId: 'proj-1',
				buildHash: 'sha256-content-hash',
			},
			{ jobId: 'worker-image-build-proj-1' },
		);
		expect(result).toBe('worker-image-build-proj-1');
	});

	it('removes any stale job for the project before enqueueing a fresh one (supersede)', async () => {
		const { enqueueWorkerImageBuildJob } = await freshImport();

		await enqueueWorkerImageBuildJob({ projectId: 'proj-7', buildHash: 'hash-7' });

		expect(mockQueueRemove).toHaveBeenCalledWith('worker-image-build-proj-7');
	});
});
