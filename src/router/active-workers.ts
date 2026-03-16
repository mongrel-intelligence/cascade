/**
 * Active worker state management for CASCADE worker containers.
 *
 * Pure state management — no Docker API usage.
 * Tracks running worker containers and handles cleanup of their associated locks.
 */

import { failOrphanedRun, failOrphanedRunFallback } from '../db/repositories/runsRepository.js';
import { logger } from '../utils/logging.js';
import { clearAgentTypeEnqueued } from './agent-type-lock.js';
import type { CascadeJob } from './queue.js';
import { clearWorkItemEnqueued } from './work-item-lock.js';

export interface ActiveWorker {
	containerId: string;
	jobId: string;
	startedAt: Date;
	timeoutHandle: NodeJS.Timeout;
	job: CascadeJob;
	/** Resolved at spawn time for work-item lock cleanup. */
	projectId?: string;
	/** Resolved at spawn time for work-item lock cleanup. */
	workItemId?: string;
	/** Resolved at spawn time for agent-type lock cleanup. */
	agentType?: string;
}

export const activeWorkers = new Map<string, ActiveWorker>();

/**
 * Get number of currently active worker containers.
 */
export function getActiveWorkerCount(): number {
	return activeWorkers.size;
}

/**
 * Get summary info for currently active workers.
 */
export function getActiveWorkers(): Array<{ jobId: string; startedAt: Date }> {
	return Array.from(activeWorkers.values()).map((w) => ({
		jobId: w.jobId,
		startedAt: w.startedAt,
	}));
}

/**
 * Clean up worker tracking state (timeout handle + map entry).
 * When exitCode is non-zero, marks the DB run as 'failed' — crash path only.
 * The timeout path (killWorker) handles its own 'timed_out' DB update and calls
 * cleanupWorker without an exitCode so this block is skipped.
 */
export function cleanupWorker(jobId: string, exitCode?: number): void {
	const worker = activeWorkers.get(jobId);
	if (worker) {
		clearTimeout(worker.timeoutHandle);
		if (worker.projectId && worker.agentType) {
			clearAgentTypeEnqueued(worker.projectId, worker.agentType);
		}
		if (worker.projectId && worker.workItemId && worker.agentType) {
			clearWorkItemEnqueued(worker.projectId, worker.workItemId, worker.agentType);
		}
		if (exitCode !== undefined && exitCode !== 0 && worker.projectId) {
			const durationMs = Date.now() - worker.startedAt.getTime();
			const updatePromise = worker.workItemId
				? failOrphanedRun(
						worker.projectId,
						worker.workItemId,
						`Worker crashed with exit code ${exitCode}`,
						'failed',
						durationMs,
					)
				: failOrphanedRunFallback(
						worker.projectId,
						worker.agentType,
						worker.startedAt,
						'failed',
						`Worker crashed with exit code ${exitCode}`,
						durationMs,
					);
			updatePromise
				.then((runId) => {
					if (runId) {
						logger.info('[WorkerManager] Marked orphaned run as failed:', {
							jobId,
							runId,
							exitCode,
						});
					}
				})
				.catch((err) => {
					logger.error('[WorkerManager] Failed to mark orphaned run:', {
						jobId,
						error: String(err),
					});
				});
		}
		activeWorkers.delete(jobId);
		logger.info('[WorkerManager] Worker cleaned up:', {
			jobId,
			activeWorkers: activeWorkers.size,
		});
	}
}

/**
 * Get all tracked container IDs (for orphan cleanup).
 */
export function getTrackedContainerIds(): Set<string> {
	return new Set(Array.from(activeWorkers.values()).map((w) => w.containerId));
}
