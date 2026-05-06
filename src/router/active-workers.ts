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
import { slotReleased } from './slot-waiter.js';
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

/**
 * Diagnostic facts about a worker exit, surfaced into the run record's `error`
 * field so post-mortem investigations can answer "was this OOM?", "was it
 * killed by Docker?" without ssh + syslog access. Sourced from
 * `dockerode container.inspect()` after `wait()`.
 */
export interface ExitDetails {
	/** `State.OOMKilled` from Docker — definitive cgroup-OOM signal. */
	oomKilled?: boolean;
	/** `State.Error` from Docker — non-empty when the runtime aborted the container. */
	exitReason?: string;
}

/**
 * Format a worker-crash reason string with whatever diagnostic facts we have.
 * Stable, grep-friendly format: `Worker crashed with exit code N · OOMKilled=… · reason="…"`.
 * Empty / undefined fields are omitted.
 */
export function formatCrashReason(exitCode: number, details?: ExitDetails): string {
	// Spec 018: exit code 2 is reserved for worker boot-time failures (template
	// load, plan resolution, context-pipeline assembly) — distinguishable from
	// a generic in-execution crash so operators can triage faster.
	const lead =
		exitCode === 2
			? `Worker boot failed (exit code ${exitCode})`
			: `Worker crashed with exit code ${exitCode}`;
	const parts: string[] = [lead];
	if (details?.oomKilled === true) parts.push('OOMKilled=true');
	else if (details?.oomKilled === false) parts.push('OOMKilled=false');
	if (details?.exitReason) parts.push(`reason="${details.exitReason}"`);
	return parts.join(' · ');
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
 *
 * Includes the resolved `(projectId, workItemId, agentType)` trio so callers
 * (specifically the lock-state classifier added in spec 015/1) can correlate
 * an in-memory lock count against actual dispatch state. The fields are
 * `undefined` for workers whose job data didn't carry the corresponding
 * identifier — never synthesized.
 */
export function getActiveWorkers(): Array<{
	jobId: string;
	startedAt: Date;
	projectId?: string;
	workItemId?: string;
	agentType?: string;
}> {
	return Array.from(activeWorkers.values()).map((w) => ({
		jobId: w.jobId,
		startedAt: w.startedAt,
		projectId: w.projectId,
		workItemId: w.workItemId,
		agentType: w.agentType,
	}));
}

/**
 * Clean up worker tracking state (timeout handle + map entry).
 * When exitCode is non-zero, marks the DB run as 'failed' — crash path only.
 * The timeout path (killWorker) handles its own 'timed_out' DB update and calls
 * cleanupWorker without an exitCode so this block is skipped.
 */
export function cleanupWorker(jobId: string, exitCode?: number, details?: ExitDetails): void {
	const worker = activeWorkers.get(jobId);
	if (worker) {
		clearTimeout(worker.timeoutHandle);
		if (worker.projectId && worker.agentType) {
			clearAgentTypeEnqueued(worker.projectId, worker.agentType);
		}
		if (worker.projectId && worker.workItemId && worker.agentType) {
			clearWorkItemEnqueued(worker.projectId, worker.workItemId, worker.agentType);
		}
		// Spec 015/2: free a worker slot so any dispatcher waiting in
		// `acquireSlot()` can proceed. Idempotent — the surrounding
		// `if (worker)` guard ensures we call this exactly once per cleanup.
		slotReleased();
		if (exitCode !== undefined && exitCode !== 0 && worker.projectId) {
			const durationMs = Date.now() - worker.startedAt.getTime();
			const reason = formatCrashReason(exitCode, details);
			const updatePromise = worker.workItemId
				? failOrphanedRun(worker.projectId, worker.workItemId, reason, 'failed', durationMs)
				: failOrphanedRunFallback(
						worker.projectId,
						worker.agentType,
						worker.startedAt,
						'failed',
						reason,
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
