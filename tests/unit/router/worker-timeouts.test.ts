import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock state
// ---------------------------------------------------------------------------

const {
	mockActiveWorkers,
	mockCleanupWorker,
	mockDockerGetContainer,
	mockFailOrphanedRun,
	mockFailOrphanedRunFallback,
	mockNotifyTimeout,
} = vi.hoisted(() => ({
	mockActiveWorkers: new Map<string, unknown>(),
	mockCleanupWorker: vi.fn(),
	mockDockerGetContainer: vi.fn(),
	mockFailOrphanedRun: vi.fn().mockResolvedValue(null),
	mockFailOrphanedRunFallback: vi.fn().mockResolvedValue(null),
	mockNotifyTimeout: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('dockerode', () => ({
	default: vi.fn().mockImplementation(() => ({
		getContainer: mockDockerGetContainer,
	})),
}));

vi.mock('../../../src/db/repositories/runsRepository.js', () => ({
	failOrphanedRun: (...args: unknown[]) => mockFailOrphanedRun(...args),
	failOrphanedRunFallback: (...args: unknown[]) => mockFailOrphanedRunFallback(...args),
}));

vi.mock('../../../src/router/active-workers.js', () => ({
	activeWorkers: mockActiveWorkers,
	cleanupWorker: (...args: unknown[]) => mockCleanupWorker(...args),
}));

vi.mock('../../../src/router/notifications.js', () => ({
	notifyTimeout: (...args: unknown[]) => mockNotifyTimeout(...args),
}));

const { mockLogger } = vi.hoisted(() => ({
	mockLogger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));
vi.mock('../../../src/utils/logging.js', () => ({
	logger: mockLogger,
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import type { ActiveWorker } from '../../../src/router/active-workers.js';
import type { CascadeJob } from '../../../src/router/queue.js';
import { killWorker } from '../../../src/router/worker-timeouts.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorker(overrides: Partial<ActiveWorker> = {}): ActiveWorker {
	return {
		containerId: overrides.containerId ?? 'container-abc123def456',
		jobId: overrides.jobId ?? 'job-1',
		startedAt: overrides.startedAt ?? new Date(Date.now() - 1000),
		timeoutHandle: overrides.timeoutHandle ?? ({} as NodeJS.Timeout),
		job: overrides.job ?? ({ type: 'trello', projectId: 'proj-1' } as CascadeJob),
		projectId: overrides.projectId,
		workItemId: overrides.workItemId,
		agentType: overrides.agentType,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('worker-timeouts killWorker', () => {
	beforeEach(() => {
		mockActiveWorkers.clear();
		mockCleanupWorker.mockClear();
		mockDockerGetContainer.mockReset();
		mockFailOrphanedRun.mockReset();
		mockFailOrphanedRun.mockResolvedValue(null);
		mockFailOrphanedRunFallback.mockReset();
		mockFailOrphanedRunFallback.mockResolvedValue(null);
		mockNotifyTimeout.mockReset();
		mockNotifyTimeout.mockResolvedValue(undefined);
		mockLogger.info.mockClear();
		mockLogger.warn.mockClear();
		mockLogger.error.mockClear();
	});

	it('is a no-op for an unknown jobId', async () => {
		await expect(killWorker('missing-job')).resolves.toBeUndefined();

		expect(mockDockerGetContainer).not.toHaveBeenCalled();
		expect(mockFailOrphanedRun).not.toHaveBeenCalled();
		expect(mockFailOrphanedRunFallback).not.toHaveBeenCalled();
		expect(mockNotifyTimeout).not.toHaveBeenCalled();
		expect(mockCleanupWorker).not.toHaveBeenCalled();
	});

	it('stops the worker container with the timeout grace period', async () => {
		const container = { stop: vi.fn().mockResolvedValue(undefined) };
		mockDockerGetContainer.mockReturnValue(container);
		mockActiveWorkers.set('job-1', makeWorker({ jobId: 'job-1' }));

		await killWorker('job-1');

		expect(mockDockerGetContainer).toHaveBeenCalledWith('container-abc123def456');
		expect(container.stop).toHaveBeenCalledWith({ t: 15 });
	});

	it('warns but still notifies and cleans up when the container is already stopped', async () => {
		const container = { stop: vi.fn().mockRejectedValue(new Error('already stopped')) };
		mockDockerGetContainer.mockReturnValue(container);
		mockActiveWorkers.set('job-stopped', makeWorker({ jobId: 'job-stopped' }));

		await killWorker('job-stopped');

		expect(mockLogger.warn).toHaveBeenCalledWith(
			'[WorkerManager] Error stopping worker (may already be stopped):',
			expect.objectContaining({ jobId: 'job-stopped' }),
		);
		expect(mockNotifyTimeout).toHaveBeenCalled();
		expect(mockCleanupWorker).toHaveBeenCalledWith('job-stopped');
	});

	it('marks a known work item run as timed_out with the router timeout reason', async () => {
		const container = { stop: vi.fn().mockResolvedValue(undefined) };
		mockDockerGetContainer.mockReturnValue(container);
		mockFailOrphanedRun.mockResolvedValue('run-123');
		mockActiveWorkers.set(
			'job-work-item',
			makeWorker({
				jobId: 'job-work-item',
				projectId: 'proj-1',
				workItemId: 'card-1',
			}),
		);

		await killWorker('job-work-item');

		expect(mockFailOrphanedRun).toHaveBeenCalledWith(
			'proj-1',
			'card-1',
			'Router timeout',
			'timed_out',
			expect.any(Number),
		);
		expect(mockFailOrphanedRunFallback).not.toHaveBeenCalled();
	});

	it('marks a run without workItemId via fallback as timed_out with the router timeout reason', async () => {
		const container = { stop: vi.fn().mockResolvedValue(undefined) };
		mockDockerGetContainer.mockReturnValue(container);
		mockFailOrphanedRunFallback.mockResolvedValue('run-fallback');
		const startedAt = new Date(Date.now() - 2000);
		mockActiveWorkers.set(
			'job-fallback',
			makeWorker({
				jobId: 'job-fallback',
				projectId: 'proj-1',
				agentType: 'implementation',
				startedAt,
			}),
		);

		await killWorker('job-fallback');

		expect(mockFailOrphanedRunFallback).toHaveBeenCalledWith(
			'proj-1',
			'implementation',
			startedAt,
			'timed_out',
			'Router timeout',
			expect.any(Number),
		);
		expect(mockFailOrphanedRun).not.toHaveBeenCalled();
	});

	it('cleans up without an exit code so cleanupWorker cannot mark the run failed', async () => {
		const container = { stop: vi.fn().mockResolvedValue(undefined) };
		mockDockerGetContainer.mockReturnValue(container);
		mockActiveWorkers.set(
			'job-no-double-write',
			makeWorker({
				jobId: 'job-no-double-write',
				projectId: 'proj-1',
				workItemId: 'card-1',
			}),
		);

		await killWorker('job-no-double-write');

		expect(mockFailOrphanedRun).toHaveBeenCalledTimes(1);
		expect(mockFailOrphanedRun).toHaveBeenCalledWith(
			'proj-1',
			'card-1',
			'Router timeout',
			'timed_out',
			expect.any(Number),
		);
		expect(mockCleanupWorker).toHaveBeenCalledTimes(1);
		expect(mockCleanupWorker).toHaveBeenCalledWith('job-no-double-write');
	});
});
