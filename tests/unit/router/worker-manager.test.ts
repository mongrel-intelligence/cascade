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

vi.mock('../../../src/router/slot-waiter.js', () => ({
	acquireSlot: vi.fn().mockResolvedValue(undefined),
	clearAllWaiters: vi.fn(),
}));

vi.mock('../../../src/router/dispatch-error-classifier.js', () => ({
	classifyDispatchError: vi.fn().mockReturnValue('transient'),
}));

vi.mock('bullmq', () => ({
	UnrecoverableError: class extends Error {
		constructor(message: string) {
			super(message);
			this.name = 'UnrecoverableError';
		}
	},
}));

vi.mock('../../../src/router/snapshot-cleanup.js', () => ({
	startSnapshotCleanup: vi.fn(),
	stopSnapshotCleanup: vi.fn(),
}));

vi.mock('../../../src/router/worker-image-validation.js', () => ({
	handleWorkerImageValidation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/router/config.js', () => ({
	routerConfig: {
		redisUrl: 'redis://localhost:6379',
		maxWorkers: 3,
		workerImage: 'test-worker:latest',
		workerMemoryMb: 512,
		workerTimeoutMs: 5000,
		slotWaitTimeoutMs: 5 * 60 * 1000,
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
import { classifyDispatchError } from '../../../src/router/dispatch-error-classifier.js';
import { acquireSlot } from '../../../src/router/slot-waiter.js';
import { startSnapshotCleanup, stopSnapshotCleanup } from '../../../src/router/snapshot-cleanup.js';
import { handleWorkerImageValidation } from '../../../src/router/worker-image-validation.js';
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
const mockAcquireSlot = vi.mocked(acquireSlot);
const mockClassifyDispatchError = vi.mocked(classifyDispatchError);
const mockHandleWorkerImageValidation = vi.mocked(handleWorkerImageValidation);

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

	// REPLACED in spec 015/2: capacity miss now waits for a slot instead of
	// throwing. The previous assertion `processFn throws when at capacity`
	// is intentionally gone (per spec AC #9) — preserved here as an
	// inverted test pinning the new contract.
	it('processFn awaits a slot when at capacity, then dispatches when one frees', async () => {
		startWorkerProcessor();

		const cascadeJobsCall = mockCreateQueueWorker.mock.calls.find(
			(call) => call[0].queueName === 'cascade-jobs',
		);
		const processFn = cascadeJobsCall?.[0].processFn as (j: unknown) => Promise<void>;

		// `acquireSlot` resolves once a slot is available — drive that here.
		let resolveAcquire: () => void = () => {};
		mockAcquireSlot.mockImplementationOnce(
			() =>
				new Promise<void>((res) => {
					resolveAcquire = res;
				}),
		);

		mockSpawnWorker.mockClear();
		const fakeJob = { id: 'j2', data: { type: 'trello', projectId: 'p1' } };
		const inflight = processFn(fakeJob);

		// Before the slot frees, spawnWorker must NOT have been called.
		await Promise.resolve();
		expect(mockSpawnWorker).not.toHaveBeenCalled();

		// Free the slot — processFn proceeds to spawnWorker.
		resolveAcquire();
		await inflight;
		expect(mockSpawnWorker).toHaveBeenCalledWith(fakeJob);
	});

	it("processFn rejects with code 'SLOT_WAIT_TIMEOUT' when the wait exceeds the timeout", async () => {
		startWorkerProcessor();

		const cascadeJobsCall = mockCreateQueueWorker.mock.calls.find(
			(call) => call[0].queueName === 'cascade-jobs',
		);
		const processFn = cascadeJobsCall?.[0].processFn as (j: unknown) => Promise<void>;

		const timeoutErr = Object.assign(new Error('Slot wait timed out'), {
			code: 'SLOT_WAIT_TIMEOUT',
		});
		mockAcquireSlot.mockRejectedValueOnce(timeoutErr);
		// Slot timeout classifies as transient → propagates unchanged so
		// BullMQ retries via attempts/backoff.
		mockClassifyDispatchError.mockReturnValueOnce('transient');

		mockSpawnWorker.mockClear();
		const fakeJob = { id: 'j2', data: { type: 'trello', projectId: 'p1' } };
		await expect(processFn(fakeJob)).rejects.toMatchObject({ code: 'SLOT_WAIT_TIMEOUT' });
		expect(mockSpawnWorker).not.toHaveBeenCalled();
	});

	it('processFn propagates a transient spawn error unchanged so BullMQ retries', async () => {
		startWorkerProcessor();

		const cascadeJobsCall = mockCreateQueueWorker.mock.calls.find(
			(call) => call[0].queueName === 'cascade-jobs',
		);
		const processFn = cascadeJobsCall?.[0].processFn as (j: unknown) => Promise<void>;

		const transientErr = Object.assign(new Error('ECONNREFUSED docker.sock'), {
			code: 'ECONNREFUSED',
		});
		mockSpawnWorker.mockRejectedValueOnce(transientErr);
		mockClassifyDispatchError.mockReturnValueOnce('transient');

		const fakeJob = { id: 'j3', data: { type: 'trello', projectId: 'p1' } };
		await expect(processFn(fakeJob)).rejects.toBe(transientErr);
	});

	it('processFn wraps a terminal spawn error in UnrecoverableError so retries are skipped', async () => {
		startWorkerProcessor();

		const cascadeJobsCall = mockCreateQueueWorker.mock.calls.find(
			(call) => call[0].queueName === 'cascade-jobs',
		);
		const processFn = cascadeJobsCall?.[0].processFn as (j: unknown) => Promise<void>;

		const terminalErr = Object.assign(new TypeError("Cannot read 'foo'"), {});
		mockSpawnWorker.mockRejectedValueOnce(terminalErr);
		mockClassifyDispatchError.mockReturnValueOnce('terminal');

		const fakeJob = { id: 'j4', data: { type: 'trello', projectId: 'p1' } };
		const rejectionSpy = vi.fn();
		await processFn(fakeJob).catch(rejectionSpy);

		expect(rejectionSpy).toHaveBeenCalledTimes(1);
		const thrown = rejectionSpy.mock.calls[0][0];
		expect((thrown as Error).name).toBe('UnrecoverableError');
	});

	// spec 022 plan 3/4 — the worker-image-validation dashboard job runs entirely
	// router-side and must NOT take a worker slot or spawn a container.
	it('routes a worker-image-validation dashboard job to the validator, not a container spawn', async () => {
		startWorkerProcessor();

		const dashboardCall = mockCreateQueueWorker.mock.calls.find(
			(call) => call[0].queueName === 'cascade-dashboard-jobs',
		);
		const processFn = dashboardCall?.[0].processFn as (j: unknown) => Promise<void>;

		mockSpawnWorker.mockClear();
		mockAcquireSlot.mockClear();
		mockHandleWorkerImageValidation.mockClear();

		const fakeJob = {
			id: 'wiv-1',
			data: {
				type: 'worker-image-validation',
				projectId: 'p1',
				ref: 'ghcr.io/acme/cascade-worker:latest',
			},
		};
		await processFn(fakeJob);

		expect(mockHandleWorkerImageValidation).toHaveBeenCalledWith({
			projectId: 'p1',
			ref: 'ghcr.io/acme/cascade-worker:latest',
		});
		expect(mockSpawnWorker).not.toHaveBeenCalled();
		expect(mockAcquireSlot).not.toHaveBeenCalled();
	});

	it('still spawns a container for non-validation dashboard jobs (manual-run)', async () => {
		startWorkerProcessor();

		const dashboardCall = mockCreateQueueWorker.mock.calls.find(
			(call) => call[0].queueName === 'cascade-dashboard-jobs',
		);
		const processFn = dashboardCall?.[0].processFn as (j: unknown) => Promise<void>;

		mockSpawnWorker.mockClear();
		mockHandleWorkerImageValidation.mockClear();

		const fakeJob = {
			id: 'mr-1',
			data: { type: 'manual-run', projectId: 'p1', agentType: 'implementation' },
		};
		await processFn(fakeJob);

		expect(mockSpawnWorker).toHaveBeenCalledWith(fakeJob);
		expect(mockHandleWorkerImageValidation).not.toHaveBeenCalled();
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
