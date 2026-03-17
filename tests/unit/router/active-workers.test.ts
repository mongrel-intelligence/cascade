import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock state — vi.hoisted creates variables before vi.mock factories run
// ---------------------------------------------------------------------------

const {
	mockFailOrphanedRun,
	mockFailOrphanedRunFallback,
	mockClearWorkItemEnqueued,
	mockClearAllWorkItemLocks,
	mockClearAgentTypeEnqueued,
	mockClearAllAgentTypeLocks,
} = vi.hoisted(() => ({
	mockFailOrphanedRun: vi.fn().mockResolvedValue(null),
	mockFailOrphanedRunFallback: vi.fn().mockResolvedValue(null),
	mockClearWorkItemEnqueued: vi.fn(),
	mockClearAllWorkItemLocks: vi.fn(),
	mockClearAgentTypeEnqueued: vi.fn(),
	mockClearAllAgentTypeLocks: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('../../../src/db/repositories/runsRepository.js', () => ({
	failOrphanedRun: (...args: unknown[]) => mockFailOrphanedRun(...args),
	failOrphanedRunFallback: (...args: unknown[]) => mockFailOrphanedRunFallback(...args),
}));

vi.mock('../../../src/router/work-item-lock.js', () => ({
	clearWorkItemEnqueued: (...args: unknown[]) => mockClearWorkItemEnqueued(...args),
	clearAllWorkItemLocks: (...args: unknown[]) => mockClearAllWorkItemLocks(...args),
}));

vi.mock('../../../src/router/agent-type-lock.js', () => ({
	clearAgentTypeEnqueued: (...args: unknown[]) => mockClearAgentTypeEnqueued(...args),
	clearAllAgentTypeLocks: (...args: unknown[]) => mockClearAllAgentTypeLocks(...args),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
	type ActiveWorker,
	activeWorkers,
	cleanupWorker,
	getActiveWorkerCount,
	getActiveWorkers,
	getTrackedContainerIds,
} from '../../../src/router/active-workers.js';
import type { CascadeJob } from '../../../src/router/queue.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeActiveWorker(overrides: Partial<ActiveWorker> = {}): ActiveWorker {
	return {
		containerId: overrides.containerId ?? 'container-abc',
		jobId: overrides.jobId ?? 'job-1',
		startedAt: overrides.startedAt ?? new Date(),
		timeoutHandle: overrides.timeoutHandle ?? (setTimeout(() => {}, 999999) as NodeJS.Timeout),
		job: overrides.job ?? ({ type: 'trello', projectId: 'proj-1' } as CascadeJob),
		projectId: overrides.projectId,
		workItemId: overrides.workItemId,
		agentType: overrides.agentType,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('active-workers', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'info').mockImplementation(() => {});
		// Clear state between tests
		activeWorkers.clear();
		mockFailOrphanedRun.mockReset();
		mockFailOrphanedRun.mockResolvedValue(null);
		mockFailOrphanedRunFallback.mockReset();
		mockFailOrphanedRunFallback.mockResolvedValue(null);
		mockClearWorkItemEnqueued.mockClear();
		mockClearAgentTypeEnqueued.mockClear();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		activeWorkers.clear();
	});

	describe('getActiveWorkerCount', () => {
		it('returns 0 when no workers', () => {
			expect(getActiveWorkerCount()).toBe(0);
		});

		it('returns correct count after adding workers', () => {
			activeWorkers.set('job-1', makeActiveWorker({ jobId: 'job-1' }));
			activeWorkers.set('job-2', makeActiveWorker({ jobId: 'job-2' }));
			expect(getActiveWorkerCount()).toBe(2);
		});
	});

	describe('getActiveWorkers', () => {
		it('returns empty array when no workers', () => {
			expect(getActiveWorkers()).toEqual([]);
		});

		it('returns summary info for tracked workers', () => {
			const startedAt = new Date();
			activeWorkers.set('job-1', makeActiveWorker({ jobId: 'job-1', startedAt }));
			const workers = getActiveWorkers();
			expect(workers).toHaveLength(1);
			expect(workers[0]).toEqual({ jobId: 'job-1', startedAt });
		});
	});

	describe('getTrackedContainerIds', () => {
		it('returns empty set when no workers', () => {
			expect(getTrackedContainerIds().size).toBe(0);
		});

		it('returns set of container IDs', () => {
			activeWorkers.set('job-1', makeActiveWorker({ jobId: 'job-1', containerId: 'c-abc' }));
			activeWorkers.set('job-2', makeActiveWorker({ jobId: 'job-2', containerId: 'c-def' }));
			const ids = getTrackedContainerIds();
			expect(ids.has('c-abc')).toBe(true);
			expect(ids.has('c-def')).toBe(true);
		});
	});

	describe('cleanupWorker', () => {
		it('is a no-op for an unknown jobId', () => {
			expect(() => cleanupWorker('nonexistent')).not.toThrow();
		});

		it('removes worker from map', () => {
			activeWorkers.set('job-1', makeActiveWorker({ jobId: 'job-1' }));
			cleanupWorker('job-1');
			expect(activeWorkers.has('job-1')).toBe(false);
		});

		it('calls clearWorkItemEnqueued when projectId, workItemId, and agentType are set', () => {
			activeWorkers.set(
				'job-wi',
				makeActiveWorker({
					jobId: 'job-wi',
					projectId: 'proj-1',
					workItemId: 'card-1',
					agentType: 'implementation',
				}),
			);

			cleanupWorker('job-wi');
			expect(mockClearWorkItemEnqueued).toHaveBeenCalledWith('proj-1', 'card-1', 'implementation');
		});

		it('calls clearAgentTypeEnqueued when projectId and agentType are set', () => {
			activeWorkers.set(
				'job-at',
				makeActiveWorker({
					jobId: 'job-at',
					projectId: 'proj-1',
					agentType: 'review',
				}),
			);

			cleanupWorker('job-at');
			expect(mockClearAgentTypeEnqueued).toHaveBeenCalledWith('proj-1', 'review');
		});

		it('calls failOrphanedRun on non-zero exit code', () => {
			mockFailOrphanedRun.mockResolvedValue('run-123');
			activeWorkers.set(
				'job-fail',
				makeActiveWorker({
					jobId: 'job-fail',
					projectId: 'proj-1',
					workItemId: 'card-1',
					agentType: 'implementation',
				}),
			);

			cleanupWorker('job-fail', 1);
			expect(mockFailOrphanedRun).toHaveBeenCalledWith(
				'proj-1',
				'card-1',
				'Worker crashed with exit code 1',
				'failed',
				expect.any(Number),
			);
		});

		it('does NOT call failOrphanedRun on zero exit code', () => {
			activeWorkers.set(
				'job-ok',
				makeActiveWorker({
					jobId: 'job-ok',
					projectId: 'proj-1',
					workItemId: 'card-1',
					agentType: 'implementation',
				}),
			);

			cleanupWorker('job-ok', 0);
			expect(mockFailOrphanedRun).not.toHaveBeenCalled();
		});

		it('does NOT call failOrphanedRun when exitCode is undefined', () => {
			activeWorkers.set(
				'job-undef',
				makeActiveWorker({
					jobId: 'job-undef',
					projectId: 'proj-1',
					workItemId: 'card-1',
				}),
			);

			cleanupWorker('job-undef');
			expect(mockFailOrphanedRun).not.toHaveBeenCalled();
		});

		it('does NOT call clearWorkItemEnqueued when agentType is missing', () => {
			activeWorkers.set(
				'job-no-agent',
				makeActiveWorker({
					jobId: 'job-no-agent',
					projectId: 'proj-1',
					workItemId: 'card-1',
					// no agentType
				}),
			);

			cleanupWorker('job-no-agent', 1);
			expect(mockClearWorkItemEnqueued).not.toHaveBeenCalled();
		});

		it('calls failOrphanedRunFallback when no workItemId but projectId exists', () => {
			mockFailOrphanedRunFallback.mockResolvedValue('run-fallback');
			const startedAt = new Date();
			activeWorkers.set(
				'job-no-wi',
				makeActiveWorker({
					jobId: 'job-no-wi',
					projectId: 'proj-1',
					startedAt,
					agentType: 'review',
					// no workItemId
				}),
			);

			cleanupWorker('job-no-wi', 1);
			expect(mockFailOrphanedRunFallback).toHaveBeenCalledWith(
				'proj-1',
				'review',
				startedAt,
				'failed',
				'Worker crashed with exit code 1',
				expect.any(Number),
			);
			expect(mockFailOrphanedRun).not.toHaveBeenCalled();
		});

		it('calls failOrphanedRunFallback with undefined agentType when both absent', () => {
			mockFailOrphanedRunFallback.mockResolvedValue('run-fallback2');
			activeWorkers.set(
				'job-no-wi-no-agent',
				makeActiveWorker({
					jobId: 'job-no-wi-no-agent',
					projectId: 'proj-1',
					// no workItemId, no agentType
				}),
			);

			cleanupWorker('job-no-wi-no-agent', 1);
			expect(mockFailOrphanedRunFallback).toHaveBeenCalled();
			expect(mockFailOrphanedRun).not.toHaveBeenCalled();
		});

		it('does NOT call either fail function when projectId is missing', () => {
			activeWorkers.set(
				'job-no-proj',
				makeActiveWorker({
					jobId: 'job-no-proj',
					// no projectId, no workItemId
				}),
			);

			cleanupWorker('job-no-proj', 1);
			expect(mockFailOrphanedRun).not.toHaveBeenCalled();
			expect(mockFailOrphanedRunFallback).not.toHaveBeenCalled();
		});
	});
});
