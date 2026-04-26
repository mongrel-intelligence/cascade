/**
 * Module-integration test for spec 015/2.
 *
 * Validates the dispatch-path retry contract end-to-end:
 *   - transient errors propagate unchanged so BullMQ retries
 *   - terminal errors are wrapped in `UnrecoverableError` so retries skip
 *   - capacity miss waits for a slot rather than failing immediately
 *
 * Wires the REAL `guardedSpawn` body (via `createQueueWorker` →
 * `processFn`) plus REAL `slot-waiter`, REAL `dispatch-error-classifier`,
 * REAL `active-workers`, mocking only `spawnWorker` (so we can simulate
 * Docker errors deterministically) and BullMQ's `Worker` constructor (so
 * we can drive `failed`/process-fn calls synthetically without a real
 * Redis). This is the load-bearing seam from spec 015/2.
 *
 * The full Redis-driven `attempts: 4 + backoff` retry timing is BullMQ's
 * own well-tested behavior; we don't re-test it here. We only verify
 * the *classification contract* on our side (transient vs terminal),
 * because that's the thing this spec changed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('bullmq', async (importOriginal) => {
	const real = (await importOriginal()) as Record<string, unknown>;
	return {
		...real,
		Worker: vi.fn().mockImplementation((_queueName, processFn, _opts) => ({
			on: vi.fn(),
			close: vi.fn().mockResolvedValue(undefined),
			__processFn: processFn,
		})),
	};
});

vi.mock('../../../src/router/container-manager.js', () => ({
	spawnWorker: vi.fn(),
	getActiveWorkerCount: vi.fn().mockReturnValue(0),
	getActiveWorkers: vi.fn().mockReturnValue([]),
	detachAll: vi.fn(),
	startOrphanCleanup: vi.fn(),
	stopOrphanCleanup: vi.fn(),
	isImageNotFoundError: vi.fn().mockReturnValue(false),
}));

// `slot-waiter` reads `getActiveWorkerCount` from `active-workers.js`, NOT
// from `container-manager.js` (despite the re-export). We mock both so the
// capacity-miss test can drive the real slot-waiter into the queued state.
vi.mock('../../../src/router/active-workers.js', () => ({
	getActiveWorkerCount: vi.fn().mockReturnValue(0),
}));

vi.mock('../../../src/router/snapshot-cleanup.js', () => ({
	startSnapshotCleanup: vi.fn(),
	stopSnapshotCleanup: vi.fn(),
}));

vi.mock('../../../src/router/snapshot-startup-sync.js', () => ({
	syncSnapshotsFromDocker: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../src/sentry.js', () => ({
	captureException: vi.fn(),
}));

import { Worker } from 'bullmq';
import { getActiveWorkerCount } from '../../../src/router/active-workers.js';
import { spawnWorker } from '../../../src/router/container-manager.js';
import { syncSnapshotsFromDocker } from '../../../src/router/snapshot-startup-sync.js';
import { startWorkerProcessor, stopWorkerProcessor } from '../../../src/router/worker-manager.js';

const MockWorker = vi.mocked(Worker);
const mockSpawnWorker = vi.mocked(spawnWorker);
const mockGetActiveWorkerCount = vi.mocked(getActiveWorkerCount);
const mockSyncSnapshots = vi.mocked(syncSnapshotsFromDocker);

interface FakeWorker {
	on: ReturnType<typeof vi.fn>;
	__processFn: (job: unknown) => Promise<void>;
}

function getProcessFn(queueName: string): (job: unknown) => Promise<void> {
	const call = MockWorker.mock.results.find((_r, i) => {
		const args = MockWorker.mock.calls[i];
		return args?.[0] === queueName;
	});
	const w = call?.value as FakeWorker | undefined;
	if (!w?.__processFn) throw new Error(`processFn not captured for queue ${queueName}`);
	return w.__processFn;
}

describe('spec 015/2: dispatch-path retry classification (module-integration)', () => {
	beforeEach(async () => {
		await stopWorkerProcessor();
		MockWorker.mockReset();
		MockWorker.mockImplementation(
			(_queueName, processFn, _opts) =>
				({
					on: vi.fn(),
					close: vi.fn().mockResolvedValue(undefined),
					__processFn: processFn,
				}) as never,
		);
		mockSpawnWorker.mockReset();
		mockGetActiveWorkerCount.mockReturnValue(0);
		mockSyncSnapshots.mockResolvedValue(undefined);
		startWorkerProcessor();
	});

	afterEach(async () => {
		await stopWorkerProcessor();
		vi.restoreAllMocks();
	});

	it('cascade-jobs: transient spawn error propagates unchanged so BullMQ retries via attempts/backoff', async () => {
		const transientErr = Object.assign(new Error('ECONNREFUSED docker.sock'), {
			code: 'ECONNREFUSED',
		});
		mockSpawnWorker.mockRejectedValueOnce(transientErr);

		const processFn = getProcessFn('cascade-jobs');
		await expect(processFn({ id: 'j1', data: { type: 'linear', projectId: 'p1' } })).rejects.toBe(
			transientErr,
		);
	});

	it('cascade-jobs: terminal spawn error is wrapped in UnrecoverableError so BullMQ skips retries', async () => {
		// TypeError is one of the terminal classes the dispatch-error
		// classifier recognises. Image-not-found is also terminal but
		// requires the real `isImageNotFoundError` predicate which is
		// stubbed in this test.
		const terminalErr = new TypeError("Cannot read 'foo' of undefined");
		mockSpawnWorker.mockRejectedValueOnce(terminalErr);

		const processFn = getProcessFn('cascade-jobs');
		const rejectionSpy = vi.fn();
		await processFn({ id: 'j2', data: { type: 'linear', projectId: 'p1' } }).catch(rejectionSpy);

		expect(rejectionSpy).toHaveBeenCalledTimes(1);
		const thrown = rejectionSpy.mock.calls[0][0];
		expect((thrown as Error).name).toBe('UnrecoverableError');
	});

	it('cascade-dashboard-jobs: transient spawn error propagates unchanged (parity with main queue)', async () => {
		const transientErr = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
		mockSpawnWorker.mockRejectedValueOnce(transientErr);

		const processFn = getProcessFn('cascade-dashboard-jobs');
		await expect(
			processFn({
				id: 'manual-run-x',
				data: {
					type: 'manual-run',
					projectId: 'p1',
					workItemId: 'MNG-1',
					agentType: 'implementation',
				},
			}),
		).rejects.toBe(transientErr);
	});

	it('cascade-dashboard-jobs: terminal spawn error is wrapped in UnrecoverableError (parity)', async () => {
		const terminalErr = new TypeError("Cannot read 'foo' of undefined");
		mockSpawnWorker.mockRejectedValueOnce(terminalErr);

		const processFn = getProcessFn('cascade-dashboard-jobs');
		const rejectionSpy = vi.fn();
		await processFn({
			id: 'manual-run-y',
			data: {
				type: 'manual-run',
				projectId: 'p1',
				workItemId: 'MNG-2',
				agentType: 'review',
			},
		}).catch(rejectionSpy);

		expect(rejectionSpy).toHaveBeenCalledTimes(1);
		const thrown = rejectionSpy.mock.calls[0][0];
		expect((thrown as Error).name).toBe('UnrecoverableError');
	});

	it('cascade-jobs: capacity miss waits for a slot, then dispatches when one frees', async () => {
		// Force "at capacity" — use 999 to be safely above any plausible
		// maxWorkers (config default 3 in the test env, real default also 3).
		mockGetActiveWorkerCount.mockReturnValue(999);
		mockSpawnWorker.mockResolvedValueOnce(undefined);

		const processFn = getProcessFn('cascade-jobs');
		const inflight = processFn({ id: 'j-cap', data: { type: 'linear', projectId: 'p1' } });

		// Before the slot frees, spawnWorker must NOT have been called.
		await Promise.resolve();
		await Promise.resolve();
		expect(mockSpawnWorker).not.toHaveBeenCalled();

		// Free a slot by importing & calling the real `slotReleased`.
		const { slotReleased } = await import('../../../src/router/slot-waiter.js');
		// Capacity is still 999 in the mock, but the waiter doesn't re-check
		// — it simply pops the head waiter. So slotReleased() unblocks the
		// inflight processFn, which proceeds to spawnWorker.
		slotReleased();

		await inflight;
		expect(mockSpawnWorker).toHaveBeenCalledTimes(1);
	});
});
