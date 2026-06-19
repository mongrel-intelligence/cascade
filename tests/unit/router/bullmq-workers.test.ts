import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — factories use vi.fn() directly (no external variable refs)
// ---------------------------------------------------------------------------

vi.mock('bullmq', () => ({
	Worker: vi.fn().mockImplementation((_queueName, _processFn, _opts) => ({
		on: vi.fn(),
	})),
	// Real-enough subclass so `instanceof` in the predicate works under the mock.
	UnrecoverableError: class UnrecoverableError extends Error {
		constructor(message?: string) {
			super(message);
			this.name = 'UnrecoverableError';
		}
	},
}));

vi.mock('../../../src/sentry.js', () => ({
	captureException: vi.fn(),
}));

vi.mock('../../../src/router/dispatch-compensator.js', () => ({
	releaseLocksForFailedJob: vi.fn().mockResolvedValue(undefined),
	recordSpawnFailureStub: vi.fn().mockResolvedValue(undefined),
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

import { UnrecoverableError, Worker } from 'bullmq';
import {
	createQueueWorker,
	isTerminalDispatchFailure,
	parseRedisUrl,
} from '../../../src/router/bullmq-workers.js';
import {
	recordSpawnFailureStub,
	releaseLocksForFailedJob,
} from '../../../src/router/dispatch-compensator.js';
import { captureException } from '../../../src/sentry.js';
import { logger } from '../../../src/utils/logging.js';

const MockWorker = vi.mocked(Worker);
const mockCaptureException = vi.mocked(captureException);
const mockLogger = vi.mocked(logger);
const mockReleaseLocksForFailedJob = vi.mocked(releaseLocksForFailedJob);
const mockRecordSpawnFailureStub = vi.mocked(recordSpawnFailureStub);

beforeEach(() => {
	MockWorker.mockClear();
	mockCaptureException.mockClear();
	mockReleaseLocksForFailedJob.mockClear();
	mockReleaseLocksForFailedJob.mockResolvedValue(undefined);
	mockRecordSpawnFailureStub.mockClear();
	mockRecordSpawnFailureStub.mockResolvedValue(undefined);
	// Re-establish default mock so each test gets a fresh mock worker
	MockWorker.mockImplementation(
		(_queueName, _processFn, _opts) =>
			({
				on: vi.fn(),
			}) as never,
	);
});

// ---------------------------------------------------------------------------
// parseRedisUrl (re-exported from utils/redis.ts)
// ---------------------------------------------------------------------------

describe('parseRedisUrl', () => {
	it('parses a simple redis URL', () => {
		const conn = parseRedisUrl('redis://localhost:6379');
		expect(conn).toEqual({ host: 'localhost', port: 6379, password: undefined });
	});

	it('defaults to port 6379 when no port specified', () => {
		const conn = parseRedisUrl('redis://localhost');
		expect(conn).toEqual({ host: 'localhost', port: 6379, password: undefined });
	});

	it('extracts password from URL', () => {
		const conn = parseRedisUrl('redis://:secret@localhost:6379');
		expect(conn.password).toBe('secret');
		expect(conn.host).toBe('localhost');
		expect(conn.port).toBe(6379);
	});
});

// ---------------------------------------------------------------------------
// createQueueWorker
// ---------------------------------------------------------------------------

describe('createQueueWorker', () => {
	const processFn = vi.fn().mockResolvedValue(undefined);
	const baseConfig = {
		queueName: 'test-queue',
		label: 'Test job',
		connection: { host: 'localhost', port: 6379 },
		concurrency: 3,
		lockDuration: 60000,
		processFn,
	};

	it('creates a Worker with the supplied config', () => {
		createQueueWorker(baseConfig);

		expect(MockWorker).toHaveBeenCalledWith(
			'test-queue',
			processFn,
			expect.objectContaining({
				connection: { host: 'localhost', port: 6379 },
				concurrency: 3,
				lockDuration: 60000,
			}),
		);
	});

	it('registers completed, failed, and error event handlers', () => {
		const worker = createQueueWorker(baseConfig);
		const mockOn = vi.mocked(worker.on);

		const registeredEvents = mockOn.mock.calls.map((call) => call[0]);
		expect(registeredEvents).toContain('completed');
		expect(registeredEvents).toContain('failed');
		expect(registeredEvents).toContain('error');
	});

	it('returns the created Worker instance', () => {
		const worker = createQueueWorker(baseConfig);
		expect(worker).toBeDefined();
		expect(typeof worker.on).toBe('function');
	});

	it('completed handler logs with label', () => {
		mockLogger.info.mockReset();
		const worker = createQueueWorker(baseConfig);
		const mockOn = vi.mocked(worker.on);

		// Find and invoke the completed handler
		const completedCall = mockOn.mock.calls.find((call) => call[0] === 'completed');
		expect(completedCall).toBeDefined();
		const completedHandler = completedCall?.[1] as (job: { id: string }) => void;
		completedHandler({ id: 'job-42' });

		expect(mockLogger.info).toHaveBeenCalledWith(
			expect.stringContaining('Test job'),
			expect.objectContaining({ jobId: 'job-42' }),
		);
	});

	it('failed handler logs error and calls captureException', () => {
		mockLogger.error.mockReset();
		const worker = createQueueWorker(baseConfig);
		const mockOn = vi.mocked(worker.on);

		const failedCall = mockOn.mock.calls.find((call) => call[0] === 'failed');
		expect(failedCall).toBeDefined();
		const failedHandler = failedCall?.[1] as (job: { id: string } | undefined, err: Error) => void;
		const err = new Error('dispatch failed');
		failedHandler({ id: 'job-7' }, err);

		expect(mockLogger.error).toHaveBeenCalledWith(
			expect.stringContaining('Test job'),
			expect.objectContaining({ jobId: 'job-7' }),
		);
		expect(mockCaptureException).toHaveBeenCalledWith(
			err,
			expect.objectContaining({
				tags: expect.objectContaining({ queue: 'test-queue' }),
			}),
		);
	});

	it('error handler logs and calls captureException', () => {
		mockLogger.error.mockReset();
		const worker = createQueueWorker(baseConfig);
		const mockOn = vi.mocked(worker.on);

		const errorCall = mockOn.mock.calls.find((call) => call[0] === 'error');
		expect(errorCall).toBeDefined();
		const errorHandler = errorCall?.[1] as (err: Error) => void;
		const err = new Error('worker crashed');
		errorHandler(err);

		expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Test job'), err);
		expect(mockCaptureException).toHaveBeenCalledWith(
			err,
			expect.objectContaining({
				tags: expect.objectContaining({ source: 'bullmq_error', queue: 'test-queue' }),
			}),
		);
	});

	it('uses queue name in Sentry tags for failed handler', () => {
		const worker = createQueueWorker({ ...baseConfig, queueName: 'my-special-queue' });
		const mockOn = vi.mocked(worker.on);

		const failedCall = mockOn.mock.calls.find((call) => call[0] === 'failed');
		const handler = failedCall?.[1] as (job: { id: string }, err: Error) => void;
		handler({ id: 'x' }, new Error('oops'));

		expect(mockCaptureException).toHaveBeenCalledWith(
			expect.any(Error),
			expect.objectContaining({
				tags: expect.objectContaining({ queue: 'my-special-queue' }),
			}),
		);
	});

	it("worker.on('failed') invokes releaseLocksForFailedJob with job.data", () => {
		const worker = createQueueWorker(baseConfig);
		const mockOn = vi.mocked(worker.on);

		const failedCall = mockOn.mock.calls.find((call) => call[0] === 'failed');
		const handler = failedCall?.[1] as (
			job: { id: string; data: unknown } | undefined,
			err: Error,
		) => void;
		const jobData = { type: 'linear', payload: 'foo' };
		handler({ id: 'job-99', data: jobData }, new Error('boom'));

		expect(mockReleaseLocksForFailedJob).toHaveBeenCalledTimes(1);
		expect(mockReleaseLocksForFailedJob).toHaveBeenCalledWith(jobData);
	});

	it("worker.on('failed') still logs and Sentries on top of compensating", () => {
		mockLogger.error.mockReset();
		const worker = createQueueWorker(baseConfig);

		const handler = vi.mocked(worker.on).mock.calls.find((c) => c[0] === 'failed')?.[1] as (
			job: { id: string; data: unknown } | undefined,
			err: Error,
		) => void;
		handler({ id: 'job-100', data: { type: 'github' } }, new Error('nope'));

		expect(mockLogger.error).toHaveBeenCalled();
		expect(mockCaptureException).toHaveBeenCalled();
		expect(mockReleaseLocksForFailedJob).toHaveBeenCalled();
	});

	it("worker.on('failed') swallows compensator throws", async () => {
		mockReleaseLocksForFailedJob.mockRejectedValueOnce(new Error('compensator boom'));
		const worker = createQueueWorker(baseConfig);
		const mockOn = vi.mocked(worker.on);

		const handler = mockOn.mock.calls.find((c) => c[0] === 'failed')?.[1] as (
			job: { id: string; data: unknown } | undefined,
			err: Error,
		) => void;

		// Calling the handler must not propagate the compensator rejection.
		// We invoke it and let the microtask queue drain — there must be no
		// unhandled rejection in test logs.
		expect(() =>
			handler({ id: 'job-101', data: { type: 'github' } }, new Error('x')),
		).not.toThrow();
		// Drain the rejection by giving microtasks a turn.
		await new Promise((r) => setImmediate(r));
		// Test passes if we got here without an unhandled rejection killing vitest.
	});

	it("worker.on('failed') does not call compensator when job is undefined", () => {
		const worker = createQueueWorker(baseConfig);
		const mockOn = vi.mocked(worker.on);

		const handler = mockOn.mock.calls.find((c) => c[0] === 'failed')?.[1] as (
			job: { id: string; data: unknown } | undefined,
			err: Error,
		) => void;
		handler(undefined, new Error('orphan'));

		expect(mockReleaseLocksForFailedJob).not.toHaveBeenCalled();
		// Existing log + Sentry behavior preserved
		expect(mockLogger.error).toHaveBeenCalled();
	});

	// -------------------------------------------------------------------------
	// Spawn-failure stub gating — the failed event fires on EVERY attempt
	// (including intermediate retries); the stub must only be recorded on a
	// terminal failure, or transient retries leave bogus `failed` run rows.
	// -------------------------------------------------------------------------

	type FailedHandler = (job: Record<string, unknown> | undefined, err: unknown) => void;

	function getFailedHandler(): FailedHandler {
		const worker = createQueueWorker(baseConfig);
		return vi.mocked(worker.on).mock.calls.find((c) => c[0] === 'failed')?.[1] as FailedHandler;
	}

	it('records the spawn-failure stub on a terminal failure (finishedOn set)', () => {
		const jobData = { type: 'github', payload: 'x' };
		getFailedHandler()(
			{ id: 'job-term', data: jobData, attemptsMade: 4, opts: { attempts: 4 }, finishedOn: 1234 },
			new Error('image not found after fallback'),
		);

		expect(mockRecordSpawnFailureStub).toHaveBeenCalledTimes(1);
		expect(mockRecordSpawnFailureStub).toHaveBeenCalledWith(jobData, expect.any(Error));
	});

	it('does NOT record the stub on an intermediate retry (finishedOn unset, attempts remain)', () => {
		getFailedHandler()(
			{ id: 'job-retry', data: { type: 'github' }, attemptsMade: 1, opts: { attempts: 4 } },
			new Error('ECONNRESET pulling image'),
		);

		expect(mockRecordSpawnFailureStub).not.toHaveBeenCalled();
		// Lock compensation must STILL fire on every attempt — only the run-row
		// stub is gated.
		expect(mockReleaseLocksForFailedJob).toHaveBeenCalledTimes(1);
	});

	it('records the stub when retries are exhausted even if finishedOn is unset (defensive fallback)', () => {
		getFailedHandler()(
			{ id: 'job-exhausted', data: { type: 'github' }, attemptsMade: 4, opts: { attempts: 4 } },
			new Error('still failing'),
		);

		expect(mockRecordSpawnFailureStub).toHaveBeenCalledTimes(1);
	});

	it('records the stub for an UnrecoverableError regardless of remaining attempts', () => {
		getFailedHandler()(
			{ id: 'job-unrec', data: { type: 'github' }, attemptsMade: 1, opts: { attempts: 4 } },
			new UnrecoverableError('validation failed'),
		);

		expect(mockRecordSpawnFailureStub).toHaveBeenCalledTimes(1);
	});

	it('swallows a throw from the stub recorder', async () => {
		mockRecordSpawnFailureStub.mockRejectedValueOnce(new Error('stub boom'));
		expect(() =>
			getFailedHandler()(
				{ id: 'job-stubthrow', data: { type: 'github' }, finishedOn: 99 },
				new Error('terminal'),
			),
		).not.toThrow();
		await new Promise((r) => setImmediate(r));
	});
});

// ---------------------------------------------------------------------------
// isTerminalDispatchFailure — predicate behind the stub gate
// ---------------------------------------------------------------------------

describe('isTerminalDispatchFailure', () => {
	// Minimal Job-shaped fixtures; the predicate reads only finishedOn / attemptsMade / opts.
	const job = (over: Record<string, unknown>) => over as never;

	it('is terminal when BullMQ set finishedOn', () => {
		expect(isTerminalDispatchFailure(job({ finishedOn: 1 }), new Error('x'))).toBe(true);
	});

	it('is NOT terminal mid-retry (no finishedOn, attempts remain)', () => {
		expect(
			isTerminalDispatchFailure(job({ attemptsMade: 1, opts: { attempts: 4 } }), new Error('x')),
		).toBe(false);
	});

	it('is terminal once attemptsMade reaches the attempt budget', () => {
		expect(
			isTerminalDispatchFailure(job({ attemptsMade: 4, opts: { attempts: 4 } }), new Error('x')),
		).toBe(true);
	});

	it('is terminal for an UnrecoverableError even with attempts remaining', () => {
		expect(
			isTerminalDispatchFailure(
				job({ attemptsMade: 1, opts: { attempts: 4 } }),
				new UnrecoverableError('terminal'),
			),
		).toBe(true);
	});

	it('treats an error named UnrecoverableError as terminal (cross-realm safety)', () => {
		const err = Object.assign(new Error('x'), { name: 'UnrecoverableError' });
		expect(isTerminalDispatchFailure(job({ attemptsMade: 1, opts: { attempts: 4 } }), err)).toBe(
			true,
		);
	});
});
