/**
 * Module-integration test for spec 015/1.
 *
 * Wires the REAL `releaseLocksForFailedJob` compensator + REAL
 * `bullmq-workers.ts` failed-event handler + REAL `agent-type-lock.ts`
 * and `work-item-lock.ts` modules, mocking only BullMQ's `Worker`
 * constructor (so we can drive the `failed` event synthetically) and the
 * `worker-env.ts` extractors (so we don't need the manifest registry +
 * DB lookups). This is the load-bearing seam from spec 015/1: when
 * BullMQ declares a job failed, the lock state acquired during the
 * webhook → enqueue path must be released — and a follow-up webhook
 * for the same trio must NOT be blocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('bullmq', () => ({
	Worker: vi.fn().mockImplementation((_queueName, _processFn, _opts) => ({
		on: vi.fn(),
	})),
}));

vi.mock('../../../src/sentry.js', () => ({
	captureException: vi.fn(),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../src/router/worker-env.js', () => ({
	extractProjectIdFromJob: vi.fn(),
	extractWorkItemId: vi.fn(),
	extractAgentType: vi.fn(),
}));

import { Worker } from 'bullmq';
import {
	clearAllAgentTypeLocks,
	markAgentTypeEnqueued,
	markRecentlyDispatched,
	wasRecentlyDispatched,
} from '../../../src/router/agent-type-lock.js';
import { createQueueWorker } from '../../../src/router/bullmq-workers.js';
import {
	clearAllWorkItemLocks,
	isWorkItemLocked,
	markWorkItemEnqueued,
} from '../../../src/router/work-item-lock.js';
import {
	extractAgentType,
	extractProjectIdFromJob,
	extractWorkItemId,
} from '../../../src/router/worker-env.js';

const MockWorker = vi.mocked(Worker);
const mockExtractProjectIdFromJob = vi.mocked(extractProjectIdFromJob);
const mockExtractWorkItemId = vi.mocked(extractWorkItemId);
const mockExtractAgentType = vi.mocked(extractAgentType);

describe('spec 015/1: dispatch-failure compensation (module-integration)', () => {
	beforeEach(() => {
		clearAllAgentTypeLocks();
		clearAllWorkItemLocks();
		MockWorker.mockClear();
		MockWorker.mockImplementation(
			(_queueName, _processFn, _opts) =>
				({
					on: vi.fn(),
				}) as never,
		);
		mockExtractProjectIdFromJob.mockReset();
		mockExtractWorkItemId.mockReset();
		mockExtractAgentType.mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('releases work-item + agent-type + recently-dispatched locks when BullMQ declares the job failed', async () => {
		// Webhook → enqueue path simulated: marks the locks like webhook-processor.ts does.
		markWorkItemEnqueued('ucho', 'MNG-350', 'implementation');
		markAgentTypeEnqueued('ucho', 'implementation');
		markRecentlyDispatched('ucho', 'implementation', 'MNG-350');

		// Sanity — locks are held.
		expect((await isWorkItemLocked('ucho', 'MNG-350', 'implementation')).locked).toBe(true);
		expect(wasRecentlyDispatched('ucho', 'implementation', 'MNG-350')).toBe(true);

		// Construct a real worker via the factory; capture its registered handlers.
		const worker = createQueueWorker({
			queueName: 'cascade-jobs',
			label: 'Job',
			connection: { host: 'localhost', port: 6379 },
			concurrency: 1,
			lockDuration: 60_000,
			processFn: vi.fn().mockResolvedValue(undefined),
		});
		const failedHandler = vi.mocked(worker.on).mock.calls.find((c) => c[0] === 'failed')?.[1] as (
			job: { id: string; data: unknown } | undefined,
			err: Error,
		) => void;
		expect(failedHandler).toBeDefined();

		// Drive the extractors so the compensator resolves to the same trio.
		mockExtractProjectIdFromJob.mockResolvedValue('ucho');
		mockExtractWorkItemId.mockReturnValue('MNG-350');
		mockExtractAgentType.mockReturnValue('implementation');

		// Synthetic failed event — the compensator runs as a side-effect.
		failedHandler(
			{ id: 'linear-1777217350854-2qvhjo', data: { type: 'linear' } },
			new Error('No worker slots available'),
		);

		// Compensator is async; let microtasks drain.
		await new Promise((r) => setImmediate(r));

		// Locks released — a fresh webhook for the same trio is NOT blocked.
		expect((await isWorkItemLocked('ucho', 'MNG-350', 'implementation')).locked).toBe(false);
		expect(wasRecentlyDispatched('ucho', 'implementation', 'MNG-350')).toBe(false);
	});

	it('does NOT release locks for a job whose extractors return null projectId (foreign provider)', async () => {
		markWorkItemEnqueued('ucho', 'MNG-350', 'implementation');
		expect((await isWorkItemLocked('ucho', 'MNG-350', 'implementation')).locked).toBe(true);

		const worker = createQueueWorker({
			queueName: 'cascade-jobs',
			label: 'Job',
			connection: { host: 'localhost', port: 6379 },
			concurrency: 1,
			lockDuration: 60_000,
			processFn: vi.fn().mockResolvedValue(undefined),
		});
		const failedHandler = vi.mocked(worker.on).mock.calls.find((c) => c[0] === 'failed')?.[1] as (
			job: { id: string; data: unknown } | undefined,
			err: Error,
		) => void;

		mockExtractProjectIdFromJob.mockResolvedValue(null);
		mockExtractWorkItemId.mockReturnValue('MNG-350');
		mockExtractAgentType.mockReturnValue('implementation');

		failedHandler({ id: 'foreign-job', data: { type: 'something-else' } }, new Error('boom'));
		await new Promise((r) => setImmediate(r));

		// Lock for ucho/MNG-350 stays — foreign-provider failures never touch
		// the trio we care about. (extractors returned null projectId.)
		expect((await isWorkItemLocked('ucho', 'MNG-350', 'implementation')).locked).toBe(true);
	});

	it('manual-run job with full trio gets its locks released too (dashboard queue parity)', async () => {
		markWorkItemEnqueued('ucho', 'MNG-350', 'implementation');
		markAgentTypeEnqueued('ucho', 'implementation');
		markRecentlyDispatched('ucho', 'implementation', 'MNG-350');

		const worker = createQueueWorker({
			queueName: 'cascade-dashboard-jobs',
			label: 'Dashboard job',
			connection: { host: 'localhost', port: 6379 },
			concurrency: 1,
			lockDuration: 60_000,
			processFn: vi.fn().mockResolvedValue(undefined),
		});
		const failedHandler = vi.mocked(worker.on).mock.calls.find((c) => c[0] === 'failed')?.[1] as (
			job: { id: string; data: unknown } | undefined,
			err: Error,
		) => void;

		mockExtractProjectIdFromJob.mockResolvedValue('ucho');
		mockExtractWorkItemId.mockReturnValue('MNG-350');
		mockExtractAgentType.mockReturnValue('implementation');

		failedHandler(
			{
				id: 'manual-run-1777219028558-jvvxni',
				data: {
					type: 'manual-run',
					projectId: 'ucho',
					workItemId: 'MNG-350',
					agentType: 'implementation',
				},
			},
			new Error('boom'),
		);
		await new Promise((r) => setImmediate(r));

		expect((await isWorkItemLocked('ucho', 'MNG-350', 'implementation')).locked).toBe(false);
		expect(wasRecentlyDispatched('ucho', 'implementation', 'MNG-350')).toBe(false);
	});
});
