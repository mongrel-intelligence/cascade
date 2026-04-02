/**
 * Unit tests for src/queue/client.ts
 *
 * Tests submitDashboardJob and getQueue lazy initialization.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks (must be set up before dynamic import) ──────────────────────────────

const mockQueueAdd = vi.fn();

vi.mock('bullmq', () => ({
	Queue: vi.fn().mockImplementation(() => ({
		add: mockQueueAdd,
	})),
}));

const mockParseRedisUrl = vi.fn().mockReturnValue({ host: 'localhost', port: 6379 });
vi.mock('../../../src/utils/redis.js', () => ({
	parseRedisUrl: (...args: unknown[]) => mockParseRedisUrl(...args),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Re-import the module freshly so each test suite starts with a clean module
 * (no cached `queue` singleton).
 */
async function freshImport() {
	// Vitest's module registry must be reset so the singleton `queue` variable
	// is re-initialised on each call.
	vi.resetModules();

	// Re-apply mocks after resetModules, because resetModules clears the mock registry.
	vi.mock('bullmq', () => ({
		Queue: vi.fn().mockImplementation(() => ({
			add: mockQueueAdd,
		})),
	}));
	vi.mock('../../../src/utils/redis.js', () => ({
		parseRedisUrl: (...args: unknown[]) => mockParseRedisUrl(...args),
	}));

	return import('../../../src/queue/client.js');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('submitDashboardJob', () => {
	beforeEach(() => {
		vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
		mockQueueAdd.mockResolvedValue({ id: 'job-id' });
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	it('submits a job with an explicit jobId and returns that id', async () => {
		const { submitDashboardJob } = await freshImport();

		const job = { type: 'manual-run' as const, projectId: 'p-1', agentType: 'implementation' };
		const result = await submitDashboardJob(job, 'my-job-id');

		expect(mockQueueAdd).toHaveBeenCalledWith('manual-run', job, { jobId: 'my-job-id' });
		expect(result).toBe('job-id');
	});

	it('returns the explicit jobId when queue.add returns no id', async () => {
		mockQueueAdd.mockResolvedValue({ id: undefined });
		const { submitDashboardJob } = await freshImport();

		const job = { type: 'retry-run' as const, runId: 'r-1', projectId: 'p-1' };
		const result = await submitDashboardJob(job, 'fallback-id');

		expect(result).toBe('fallback-id');
	});

	it('auto-generates a jobId when none is provided', async () => {
		const { submitDashboardJob } = await freshImport();

		const job = {
			type: 'debug-analysis' as const,
			runId: 'r-2',
			projectId: 'p-2',
		};
		const result = await submitDashboardJob(job);

		// Result should be the id returned by queue.add
		expect(result).toBe('job-id');

		// The jobId passed to queue.add should be auto-generated and start with the job type
		const callArgs = mockQueueAdd.mock.calls[0];
		const options = callArgs[2] as { jobId: string };
		expect(options.jobId).toMatch(/^debug-analysis-/);
	});

	it('uses auto-generated jobId as fallback when queue returns no id', async () => {
		mockQueueAdd.mockResolvedValue({ id: undefined });
		const { submitDashboardJob } = await freshImport();

		const job = { type: 'manual-run' as const, projectId: 'p-3', agentType: 'review' };
		const result = await submitDashboardJob(job);

		// Should fall back to the auto-generated id (matches the jobId passed to queue.add)
		const callArgs = mockQueueAdd.mock.calls[0];
		const options = callArgs[2] as { jobId: string };
		expect(result).toBe(options.jobId);
		expect(result).toMatch(/^manual-run-/);
	});
});

describe('getQueue lazy initialization', () => {
	beforeEach(() => {
		vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
		mockQueueAdd.mockResolvedValue({ id: 'job-id' });
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	it('creates the Queue only once across multiple submitDashboardJob calls', async () => {
		const { Queue } = await import('bullmq');
		const QueueMock = Queue as ReturnType<typeof vi.fn>;
		QueueMock.mockClear();

		const { submitDashboardJob } = await freshImport();
		const { Queue: QueueAfter } = await import('bullmq');
		const QueueAfterMock = QueueAfter as ReturnType<typeof vi.fn>;
		QueueAfterMock.mockClear();

		const job = { type: 'manual-run' as const, projectId: 'p-1', agentType: 'implementation' };

		await submitDashboardJob(job);
		await submitDashboardJob(job);
		await submitDashboardJob(job);

		// Queue constructor should only be called once (lazy singleton)
		expect(QueueAfterMock).toHaveBeenCalledTimes(1);
	});

	it('passes parsed connection options to the Queue constructor', async () => {
		const parsedConnection = { host: 'my-redis', port: 6380 };
		mockParseRedisUrl.mockReturnValue(parsedConnection);

		const { Queue } = await import('bullmq');
		const QueueMock = Queue as ReturnType<typeof vi.fn>;

		vi.stubEnv('REDIS_URL', 'redis://my-redis:6380');
		const { submitDashboardJob } = await freshImport();

		const job = { type: 'manual-run' as const, projectId: 'p-1', agentType: 'implementation' };
		await submitDashboardJob(job);

		expect(mockParseRedisUrl).toHaveBeenCalledWith('redis://my-redis:6380');
		expect(QueueMock).toHaveBeenCalledWith(
			'cascade-dashboard-jobs',
			expect.objectContaining({ connection: parsedConnection }),
		);
	});
});

describe('getQueue error handling', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	it('throws an error when REDIS_URL is not set', async () => {
		// Ensure REDIS_URL is not present in the environment
		const saved = process.env.REDIS_URL;
		delete process.env.REDIS_URL;

		try {
			const { submitDashboardJob } = await freshImport();

			const job = { type: 'manual-run' as const, projectId: 'p-1', agentType: 'implementation' };
			await expect(submitDashboardJob(job)).rejects.toThrow('REDIS_URL is required');
		} finally {
			if (saved !== undefined) {
				process.env.REDIS_URL = saved;
			}
		}
	});
});
