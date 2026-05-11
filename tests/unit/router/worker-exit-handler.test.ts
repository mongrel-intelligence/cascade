import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCaptureException, mockLoggerInfo, mockLoggerWarn } = vi.hoisted(() => ({
	mockCaptureException: vi.fn(),
	mockLoggerInfo: vi.fn(),
	mockLoggerWarn: vi.fn(),
}));

vi.mock('../../../src/sentry.js', () => ({
	captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: (...args: unknown[]) => mockLoggerInfo(...args),
		warn: (...args: unknown[]) => mockLoggerWarn(...args),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

import {
	handleWorkerExit,
	inspectExitedContainer,
} from '../../../src/router/worker-exit-handler.js';

function makeContainer(options: {
	id?: string;
	state?: Record<string, unknown> | null;
	inspectRejects?: boolean;
	logs?: string;
	logsReject?: boolean;
	events?: string[];
}) {
	const events = options.events;
	return {
		id: options.id ?? 'container-exit-123',
		inspect: options.inspectRejects
			? vi.fn().mockImplementation(async () => {
					events?.push('inspect');
					throw new Error('socket hang up');
				})
			: vi.fn().mockImplementation(async () => {
					events?.push('inspect');
					return options.state === null ? null : { State: options.state ?? {} };
				}),
		logs: options.logsReject
			? vi.fn().mockImplementation(async () => {
					events?.push('logs');
					throw new Error('logs unavailable');
				})
			: vi.fn().mockImplementation(async () => {
					events?.push('logs');
					return Buffer.from(options.logs ?? '');
				}),
	};
}

function makeDependencies(events: string[] = []) {
	return {
		commitWorkerSnapshot: vi.fn().mockImplementation(async () => {
			events.push('commit');
		}),
		removeWorkerContainerBestEffort: vi.fn().mockImplementation(async () => {
			events.push('remove');
		}),
		cleanupWorker: vi.fn().mockImplementation(() => {
			events.push('cleanup');
		}),
	};
}

describe('inspectExitedContainer', () => {
	beforeEach(() => {
		mockLoggerInfo.mockReset();
		mockLoggerWarn.mockReset();
		mockCaptureException.mockReset();
	});

	it('extracts OOM, State.Error, and duration before cleanup can remove the container', async () => {
		const container = makeContainer({
			state: {
				OOMKilled: true,
				Error: 'OCI runtime error: exec failed',
				StartedAt: '2026-04-25T08:00:00.000Z',
				FinishedAt: '2026-04-25T08:00:30.000Z',
			},
		});

		await expect(inspectExitedContainer(container as never, 'job-oom')).resolves.toEqual({
			oomKilled: true,
			exitReason: 'OCI runtime error: exec failed',
			durationMs: 30_000,
		});
	});

	it('returns undefined facts and logs a warning when inspection fails', async () => {
		const container = makeContainer({ inspectRejects: true });

		await expect(inspectExitedContainer(container as never, 'job-inspect-fail')).resolves.toEqual({
			oomKilled: undefined,
			exitReason: undefined,
			durationMs: undefined,
		});
		expect(mockLoggerWarn).toHaveBeenCalledWith(
			'[WorkerManager] container.inspect() after wait failed:',
			expect.objectContaining({ jobId: 'job-inspect-fail' }),
		);
	});
});

describe('handleWorkerExit', () => {
	beforeEach(() => {
		mockLoggerInfo.mockReset();
		mockLoggerWarn.mockReset();
		mockCaptureException.mockReset();
	});

	it('preserves snapshot-enabled successful cleanup ordering', async () => {
		const events: string[] = [];
		const container = makeContainer({
			events,
			state: {
				OOMKilled: false,
				Error: '',
				StartedAt: '2026-04-25T08:00:00.000Z',
				FinishedAt: '2026-04-25T08:00:30.000Z',
			},
			logs: 'worker output',
		});
		const dependencies = makeDependencies(events);

		await handleWorkerExit({
			container: container as never,
			result: { StatusCode: 0 },
			jobId: 'job-success',
			jobType: 'trello',
			snapshotEnabled: true,
			projectId: 'proj-1',
			workItemId: 'card-1',
			dependencies,
		});

		expect(events).toEqual(['inspect', 'logs', 'commit', 'remove', 'cleanup']);
		expect(dependencies.commitWorkerSnapshot).toHaveBeenCalledWith(
			'container-exit-123',
			'proj-1',
			'card-1',
		);
		expect(dependencies.cleanupWorker).toHaveBeenCalledWith('job-success', 0, {
			oomKilled: false,
			exitReason: undefined,
		});
	});

	it('captures non-zero exits with worker_exit tags and Docker diagnostic facts', async () => {
		const events: string[] = [];
		mockCaptureException.mockImplementation(() => {
			events.push('capture');
		});
		const container = makeContainer({
			events,
			state: {
				OOMKilled: true,
				Error: 'Out of memory',
				StartedAt: '2026-04-25T08:00:00.000Z',
				FinishedAt: '2026-04-25T08:00:05.000Z',
			},
		});
		const dependencies = makeDependencies(events);

		await handleWorkerExit({
			container: container as never,
			result: { StatusCode: 137 },
			jobId: 'job-crashed',
			jobType: 'github',
			snapshotEnabled: true,
			projectId: 'proj-1',
			workItemId: 'card-1',
			dependencies,
		});

		expect(events).toEqual(['inspect', 'logs', 'capture', 'remove', 'cleanup']);
		expect(dependencies.commitWorkerSnapshot).not.toHaveBeenCalled();
		expect(mockCaptureException).toHaveBeenCalledWith(expect.any(Error), {
			tags: { source: 'worker_exit', jobType: 'github' },
			extra: {
				jobId: 'job-crashed',
				statusCode: 137,
				oomKilled: true,
				exitReason: 'Out of memory',
				durationMs: 5000,
			},
		});
		expect(dependencies.cleanupWorker).toHaveBeenCalledWith('job-crashed', 137, {
			oomKilled: true,
			exitReason: 'Out of memory',
		});
	});

	it('tail-log failures are best-effort and do not block cleanup', async () => {
		const events: string[] = [];
		const container = makeContainer({
			events,
			logsReject: true,
			state: {
				OOMKilled: false,
				Error: '',
				StartedAt: '2026-04-25T08:00:00.000Z',
				FinishedAt: '2026-04-25T08:00:01.000Z',
			},
		});
		const dependencies = makeDependencies(events);

		await handleWorkerExit({
			container: container as never,
			result: { StatusCode: 0 },
			jobId: 'job-log-fail',
			jobType: 'linear',
			snapshotEnabled: false,
			projectId: 'proj-1',
			workItemId: 'item-1',
			dependencies,
		});

		expect(events).toEqual(['inspect', 'logs', 'cleanup']);
		expect(dependencies.cleanupWorker).toHaveBeenCalledWith('job-log-fail', 0, {
			oomKilled: false,
			exitReason: undefined,
		});
	});
});
