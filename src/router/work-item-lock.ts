/**
 * Work-item concurrency lock for the router.
 *
 * Two layers:
 * 1. In-memory map — closes the race window between addJob() and worker createRun()
 * 2. DB query — authoritative, survives restarts, detects orphaned workers
 */

import { hasActiveRunForWorkItem } from '../db/repositories/runsRepository.js';
import { logger } from '../utils/logging.js';

const TTL_MS = 30 * 60 * 1000; // 30 minutes

interface EnqueuedEntry {
	timestamp: number;
}

const enqueuedMap = new Map<string, EnqueuedEntry>();

function makeKey(projectId: string, workItemId: string): string {
	return `${projectId}:${workItemId}`;
}

/**
 * Check whether a work item is currently locked (either enqueued in-memory
 * or has a running agent_run in the database).
 */
export async function isWorkItemLocked(
	projectId: string,
	workItemId: string,
): Promise<{ locked: boolean; reason?: string }> {
	const key = makeKey(projectId, workItemId);

	// Lazy TTL cleanup
	const entry = enqueuedMap.get(key);
	if (entry) {
		if (Date.now() - entry.timestamp > TTL_MS) {
			enqueuedMap.delete(key);
			logger.info('[WorkItemLock] TTL expired, releasing in-memory lock', {
				projectId,
				workItemId,
			});
		} else {
			return {
				locked: true,
				reason: `in-memory: enqueued at ${new Date(entry.timestamp).toISOString()}`,
			};
		}
	}

	// DB check
	const hasActive = await hasActiveRunForWorkItem(projectId, workItemId);
	if (hasActive) {
		return { locked: true, reason: 'db: active run exists' };
	}

	return { locked: false };
}

/**
 * Mark a work item as enqueued (in-memory, fast path).
 * Called after addJob() succeeds.
 */
export function markWorkItemEnqueued(projectId: string, workItemId: string): void {
	const key = makeKey(projectId, workItemId);
	enqueuedMap.set(key, { timestamp: Date.now() });
}

/**
 * Clear the in-memory enqueued mark for a work item.
 * Called when a worker container exits.
 */
export function clearWorkItemEnqueued(projectId: string, workItemId: string): void {
	const key = makeKey(projectId, workItemId);
	enqueuedMap.delete(key);
}

/**
 * Clear all in-memory locks (used on router shutdown / detachAll).
 */
export function clearAllWorkItemLocks(): void {
	enqueuedMap.clear();
}
