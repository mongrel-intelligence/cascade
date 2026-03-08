/**
 * Work-item concurrency lock for the router.
 *
 * Allows up to 2 agents per work item (e.g. implementation + review overlap),
 * but only 1 agent of the same type per work item.
 *
 * Two layers:
 * 1. In-memory map — closes the race window between addJob() and worker createRun()
 * 2. DB query — authoritative, survives restarts, detects orphaned workers
 */

import { countActiveRuns } from '../db/repositories/runsRepository.js';
import { logger } from '../utils/logging.js';
import { routerConfig } from './config.js';

export const MAX_WORK_ITEM_CONCURRENCY = 2;
export const MAX_SAME_TYPE_PER_WORK_ITEM = 1;

const TTL_MS = 30 * 60 * 1000; // 30 minutes

interface EnqueuedEntry {
	timestamp: number;
	count: number;
}

const enqueuedMap = new Map<string, EnqueuedEntry>();

function makeKey(projectId: string, workItemId: string, agentType: string): string {
	return `${projectId}:${workItemId}:${agentType}`;
}

function keyPrefix(projectId: string, workItemId: string): string {
	return `${projectId}:${workItemId}:`;
}

/**
 * Sum in-memory counts for all agent types on a given work item.
 * Skips TTL-expired entries and cleans them up lazily.
 */
function getInMemoryCounts(
	projectId: string,
	workItemId: string,
	agentType: string,
): { total: number; sameType: number } {
	const prefix = keyPrefix(projectId, workItemId);
	const now = Date.now();
	let total = 0;
	let sameType = 0;

	for (const [key, entry] of enqueuedMap) {
		if (!key.startsWith(prefix)) continue;
		if (now - entry.timestamp > TTL_MS) {
			enqueuedMap.delete(key);
			logger.info('[WorkItemLock] TTL expired, releasing in-memory lock', {
				projectId,
				workItemId,
			});
			continue;
		}
		total += entry.count;
		if (key === makeKey(projectId, workItemId, agentType)) {
			sameType = entry.count;
		}
	}

	return { total, sameType };
}

/**
 * Check whether a work item is currently locked for the given agent type.
 *
 * Locked when:
 * - Same agent type already has MAX_SAME_TYPE_PER_WORK_ITEM agents running/enqueued
 * - Total agents on this work item already at MAX_WORK_ITEM_CONCURRENCY
 */
export async function isWorkItemLocked(
	projectId: string,
	workItemId: string,
	agentType: string,
): Promise<{ locked: boolean; reason?: string }> {
	const { total: inMemoryTotal, sameType: inMemorySameType } = getInMemoryCounts(
		projectId,
		workItemId,
		agentType,
	);

	// Short-circuit: in-memory alone proves locked
	if (inMemorySameType >= MAX_SAME_TYPE_PER_WORK_ITEM) {
		return {
			locked: true,
			reason: `in-memory same-type: ${inMemorySameType} enqueued (max ${MAX_SAME_TYPE_PER_WORK_ITEM} per type)`,
		};
	}
	if (inMemoryTotal >= MAX_WORK_ITEM_CONCURRENCY) {
		return {
			locked: true,
			reason: `in-memory total: ${inMemoryTotal} enqueued (max ${MAX_WORK_ITEM_CONCURRENCY})`,
		};
	}

	// DB check — ignore runs older than 2× worker timeout (stale/orphaned)
	const maxAgeMs = 2 * routerConfig.workerTimeoutMs;
	const [dbTotal, dbSameType] = await Promise.all([
		countActiveRuns({ projectId, cardId: workItemId, maxAgeMs }),
		countActiveRuns({ projectId, cardId: workItemId, agentType, maxAgeMs }),
	]);

	// Same-type check first (more specific)
	const effectiveSameType = Math.max(dbSameType, inMemorySameType);
	if (effectiveSameType >= MAX_SAME_TYPE_PER_WORK_ITEM) {
		return {
			locked: true,
			reason: `same-type: ${dbSameType} running, ${inMemorySameType} enqueued (max ${MAX_SAME_TYPE_PER_WORK_ITEM} per type)`,
		};
	}

	// Total work-item check
	const effectiveTotal = Math.max(dbTotal, inMemoryTotal);
	if (effectiveTotal >= MAX_WORK_ITEM_CONCURRENCY) {
		return {
			locked: true,
			reason: `total: ${dbTotal} running, ${inMemoryTotal} enqueued (max ${MAX_WORK_ITEM_CONCURRENCY})`,
		};
	}

	return { locked: false };
}

/**
 * Mark a work item + agent type as enqueued (in-memory, fast path).
 * Called after addJob() succeeds.
 */
export function markWorkItemEnqueued(
	projectId: string,
	workItemId: string,
	agentType: string,
): void {
	const key = makeKey(projectId, workItemId, agentType);
	const existing = enqueuedMap.get(key);
	if (existing && Date.now() - existing.timestamp <= TTL_MS) {
		existing.count += 1;
		existing.timestamp = Date.now();
	} else {
		enqueuedMap.set(key, { timestamp: Date.now(), count: 1 });
	}
}

/**
 * Clear one enqueued slot for a work item + agent type.
 * Called when a worker container exits.
 */
export function clearWorkItemEnqueued(
	projectId: string,
	workItemId: string,
	agentType: string,
): void {
	const key = makeKey(projectId, workItemId, agentType);
	const entry = enqueuedMap.get(key);
	if (entry) {
		entry.count -= 1;
		if (entry.count <= 0) {
			enqueuedMap.delete(key);
		}
	}
}

/**
 * Clear all in-memory locks (used on router shutdown / detachAll).
 */
export function clearAllWorkItemLocks(): void {
	enqueuedMap.clear();
}
