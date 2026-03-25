import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — all factories use vi.fn() directly (no external variable refs)
// ---------------------------------------------------------------------------

vi.mock('../../../src/router/bullmq-workers.js', () => ({
	createQueueWorker: vi.fn(),
	parseRedisUrl: vi.fn().mockReturnValue({ host: 'localhost', port: 6379 }),
}));

vi.mock('../../../src/router/container-manager.js', () => ({
	spawnWorker: vi.fn().mockResolvedValue(undefined),
	getActiveWorkerCount: vi.fn().mockReturnValue(0),
	getActiveWorkers: vi.fn().mockReturnValue([]),
	detachAll: vi.fn(),
	startOrphanCleanup: vi.fn(),
	stopOrphanCleanup: vi.fn(),
}));

vi.mock('../../../src/router/snapshot-cleanup.js', () => ({
	startSnapshotCleanup: vi.fn(),
	stopSnapshotCleanup: vi.fn(),
}));

vi.mock('../../../src/router/config.js', () => ({
	routerConfig: {
		redisUrl: 'redis://localhost:6379',
		maxWorkers: 3,
		workerImage: 'test-worker:latest',
		workerMemoryMb: 512,
		workerTimeoutMs: 5000,
		dockerNetwork: 'test-network',
	},
}));

// Mock logger
vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { createQueueWorker, parseRedisUrl } from '../../../src/router/bullmq-workers.js';
import {
	detachAll,
	getActiveWorkerCount,
	getActiveWorkers,
	spawnWorker,
	startOrphanCleanup,
	stopOrphanCleanup,
} from '../../../src/router/container-manager.js';
import { startSnapshotCleanup, stopSnapshotCleanup } from '../../../src/router/snapshot-cleanup.js';
import {
	startWorkerProcessor,
	stopWorkerProcessor,
	getActiveWorkerCount as wmGetActiveWorkerCount,
	getActiveWorkers as wmGetActiveWorkers,
} from '../../../src/router/worker-manager.js';
import { logger } from '../../../src/utils/logging.js';

const mockCreateQueueWorker = vi.mocked(createQueueWorker);
const mockParseRedisUrl = vi.mocked(parseRedisUrl);
const mockSpawnWorker = vi.mocked(spawnWorker);
const mockGetActiveWorkerCount = vi.mocked(getActiveWorkerCount);
const mockGetActiveWorkers = vi.mocked(getActiveWorkers);
const mockDetachAll = vi.mocked(detachAll);
const mockStartOrphanCleanup = vi.mocked(startOrphanCleanup);
const mockStopOrphanCleanup = vi.mocked(stopOrphanCleanup);
const mockStartSnapshotCleanup = vi.mocked(startSnapshotCleanup);
const mockStopSnapshotCleanup = vi.mocked(stopSnapshotCleanup);
const mockLogger = vi.mocked(logger);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockWorker() {
	return { close: vi.fn().mockResolvedValue(undefined) };
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

describe('re-exports', () => {
	it('getActiveWorkerCount delegates to container-manager', () => {
		mockGetActiveWorkerCount.mockReturnValue(5);
		expect(wmGetActiveWorkerCount()).toBe(5);
	});

	it('getActiveWorkers delegates to container-manager', () => {
		const workers = [{ jobId: 'j1', startedAt: new Date() }];
		mockGetActiveWorkers.mockReturnValue(workers);
		expect(wmGetActiveWorkers()).toBe(workers);
	});
});

// ---------------------------------------------------------------------------
// startWorkerProcessor
// ---------------------------------------------------------------------------

describe('startWorkerProcessor', () => {
	beforeEach(async () => {
		mockLogger.info.mockReset();
		mockLogger.warn.mockReset();
		mockCreateQueueWorker.mockReturnValue(makeMockWorker() as never);
		// Ensure clean state
		await stopWorkerProcessor();
		mockCreateQueueWorker.mockClear();
		mockParseRedisUrl.mockClear();
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await stopWorkerProcessor();
	});

	it('creates two queue workers (cascade-jobs and cascade-dashboard-jobs)', () => {
		startWorkerProcessor();

		expect(mockCreateQueueWorker).toHaveBeenCalledTimes(2);
		const queueNames = mockCreateQueueWorker.mock.calls.map((call) => call[0].queueName);
		expect(queueNames).toContain('cascade-jobs');
		expect(queueNames).toContain('cascade-dashboard-jobs');
	});

	it('passes parsed Redis connection to both workers', () => {
		const connection = { host: 'redis-host', port: 6380 };
		mockParseRedisUrl.mockReturnValue(connection);

		startWorkerProcessor();

		for (const call of mockCreateQueueWorker.mock.calls) {
			expect(call[0].connection).toBe(connection);
		}
	});

	it('configures maxWorkers as concurrency for both workers', () => {
		startWorkerProcessor();

		for (const call of mockCreateQueueWorker.mock.calls) {
			expect(call[0].concurrency).toBe(3); // routerConfig.maxWorkers
		}
	});

	it('does not create duplicate workers when called twice', () => {
		startWorkerProcessor();
		startWorkerProcessor(); // second call should warn and return early

		expect(mockCreateQueueWorker).toHaveBeenCalledTimes(2); // still only 2 workers total
		expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('already started'));
	});

	it('passes a processFn that checks capacity before spawning', async () => {
		startWorkerProcessor();

		// Get the processFn from the cascade-jobs worker call
		const cascadeJobsCall = mockCreateQueueWorker.mock.calls.find(
			(call) => call[0].queueName === 'cascade-jobs',
		);
		expect(cascadeJobsCall).toBeDefined();
		const processFn = cascadeJobsCall?.[0].processFn;

		// When under capacity, spawnWorker should be called
		mockGetActiveWorkerCount.mockReturnValue(0);
		const fakeJob = { id: 'j1', data: { type: 'trello', projectId: 'p1' } };
		await processFn(fakeJob);
		expect(mockSpawnWorker).toHaveBeenCalledWith(fakeJob);
	});

	it('processFn throws when at capacity', async () => {
		startWorkerProcessor();

		const cascadeJobsCall = mockCreateQueueWorker.mock.calls.find(
			(call) => call[0].queueName === 'cascade-jobs',
		);
		const processFn = cascadeJobsCall?.[0].processFn;

		// At capacity
		mockGetActiveWorkerCount.mockReturnValue(3); // equals maxWorkers
		const fakeJob = { id: 'j2', data: { type: 'trello', projectId: 'p1' } };
		await expect(processFn(fakeJob)).rejects.toThrow('No worker slots available');
		expect(mockSpawnWorker).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// stopWorkerProcessor
// ---------------------------------------------------------------------------

describe('stopWorkerProcessor', () => {
	beforeEach(async () => {
		mockLogger.info.mockReset();
		mockLogger.warn.mockReset();
		mockCreateQueueWorker.mockReturnValue(makeMockWorker() as never);
		await stopWorkerProcessor(); // ensure clean state
		mockCreateQueueWorker.mockClear();
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await stopWorkerProcessor();
	});

	it('closes both workers', async () => {
		const worker1 = makeMockWorker();
		const worker2 = makeMockWorker();
		mockCreateQueueWorker
			.mockReturnValueOnce(worker1 as never)
			.mockReturnValueOnce(worker2 as never);

		startWorkerProcessor();
		await stopWorkerProcessor();

		expect(worker1.close).toHaveBeenCalled();
		expect(worker2.close).toHaveBeenCalled();
	});

	it('calls detachAll to release container references', async () => {
		startWorkerProcessor();
		await stopWorkerProcessor();

		expect(mockDetachAll).toHaveBeenCalled();
	});

	it('is idempotent — safe to call multiple times', async () => {
		startWorkerProcessor();
		await stopWorkerProcessor();
		mockDetachAll.mockClear();
		await stopWorkerProcessor(); // second call should not throw

		expect(mockDetachAll).toHaveBeenCalledTimes(1);
	});

	it('logs Stopped message', async () => {
		startWorkerProcessor();
		await stopWorkerProcessor();

		expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Stopped'));
	});

	it('calls startOrphanCleanup during startup', () => {
		startWorkerProcessor();
		expect(mockStartOrphanCleanup).toHaveBeenCalled();
	});

	it('calls stopOrphanCleanup during shutdown', async () => {
		startWorkerProcessor();
		await stopWorkerProcessor();
		expect(mockStopOrphanCleanup).toHaveBeenCalled();
	});

	it('calls startSnapshotCleanup during startup', () => {
		startWorkerProcessor();
		expect(mockStartSnapshotCleanup).toHaveBeenCalled();
	});

	it('calls stopSnapshotCleanup during shutdown', async () => {
		startWorkerProcessor();
		await stopWorkerProcessor();
		expect(mockStopSnapshotCleanup).toHaveBeenCalled();
	});
});
