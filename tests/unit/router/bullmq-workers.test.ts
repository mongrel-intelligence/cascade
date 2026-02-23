import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — factories use vi.fn() directly (no external variable refs)
// ---------------------------------------------------------------------------

vi.mock('bullmq', () => ({
	Worker: vi.fn().mockImplementation((_queueName, _processFn, _opts) => ({
		on: vi.fn(),
	})),
}));

vi.mock('../../../src/sentry.js', () => ({
	captureException: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { Worker } from 'bullmq';
import { createQueueWorker, parseRedisConnection } from '../../../src/router/bullmq-workers.js';
import { captureException } from '../../../src/sentry.js';

const MockWorker = vi.mocked(Worker);
const mockCaptureException = vi.mocked(captureException);

beforeEach(() => {
	MockWorker.mockClear();
	mockCaptureException.mockClear();
	// Re-establish default mock so each test gets a fresh mock worker
	MockWorker.mockImplementation(
		(_queueName, _processFn, _opts) =>
			({
				on: vi.fn(),
			}) as never,
	);
});

// ---------------------------------------------------------------------------
// parseRedisConnection
// ---------------------------------------------------------------------------

describe('parseRedisConnection', () => {
	it('parses a simple redis URL', () => {
		const conn = parseRedisConnection('redis://localhost:6379');
		expect(conn).toEqual({ host: 'localhost', port: 6379, password: undefined });
	});

	it('defaults to port 6379 when no port specified', () => {
		const conn = parseRedisConnection('redis://localhost');
		expect(conn).toEqual({ host: 'localhost', port: 6379, password: undefined });
	});

	it('extracts password from URL', () => {
		const conn = parseRedisConnection('redis://:secret@localhost:6379');
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
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		const worker = createQueueWorker(baseConfig);
		const mockOn = vi.mocked(worker.on);

		// Find and invoke the completed handler
		const completedCall = mockOn.mock.calls.find((call) => call[0] === 'completed');
		expect(completedCall).toBeDefined();
		const completedHandler = completedCall?.[1] as (job: { id: string }) => void;
		completedHandler({ id: 'job-42' });

		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining('Test job'),
			expect.objectContaining({ jobId: 'job-42' }),
		);
		logSpy.mockRestore();
	});

	it('failed handler logs error and calls captureException', () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const worker = createQueueWorker(baseConfig);
		const mockOn = vi.mocked(worker.on);

		const failedCall = mockOn.mock.calls.find((call) => call[0] === 'failed');
		expect(failedCall).toBeDefined();
		const failedHandler = failedCall?.[1] as (job: { id: string } | undefined, err: Error) => void;
		const err = new Error('dispatch failed');
		failedHandler({ id: 'job-7' }, err);

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining('Test job'),
			expect.objectContaining({ jobId: 'job-7' }),
		);
		expect(mockCaptureException).toHaveBeenCalledWith(
			err,
			expect.objectContaining({
				tags: expect.objectContaining({ queue: 'test-queue' }),
			}),
		);
		errorSpy.mockRestore();
	});

	it('error handler logs and calls captureException', () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const worker = createQueueWorker(baseConfig);
		const mockOn = vi.mocked(worker.on);

		const errorCall = mockOn.mock.calls.find((call) => call[0] === 'error');
		expect(errorCall).toBeDefined();
		const errorHandler = errorCall?.[1] as (err: Error) => void;
		const err = new Error('worker crashed');
		errorHandler(err);

		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Test job'), err);
		expect(mockCaptureException).toHaveBeenCalledWith(
			err,
			expect.objectContaining({
				tags: expect.objectContaining({ source: 'bullmq_error', queue: 'test-queue' }),
			}),
		);
		errorSpy.mockRestore();
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
});
