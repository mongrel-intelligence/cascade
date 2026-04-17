/**
 * Work-item concurrency lock for the router.
 *
 * Only 1 agent of the same type per work item. Different agent types can
 * run concurrently (e.g. review starts while implementation's container is
 * still cleaning up). The total-concurrency cap was removed in spec 007
 * because it falsely serialized unrelated agent types — the review for
 * MNG-122/PR-572 was silently dropped because two agents were already
 * enqueued for the same work item.
 *
 * Two layers:
 * 1. In-memory map — closes the race window between addJob() and worker createRun()
 * 2. DB query — authoritative, survives restarts, detects orphaned workers
 */

import { countActiveRuns } from '../db/repositories/runsRepository.js';
import { logger } from '../utils/logging.js';
import { routerConfig } from './config.js';

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

/**
 * Get the in-memory enqueue count for a specific (projectId, workItemId, agentType).
 * Cleans up TTL-expired entries lazily.
 */
function getInMemorySameTypeCount(
	projectId: string,
	workItemId: string,
	agentType: string,
): number {
	const key = makeKey(projectId, workItemId, agentType);
	const entry = enqueuedMap.get(key);
	if (!entry) return 0;
	if (Date.now() - entry.timestamp > TTL_MS) {
		enqueuedMap.delete(key);
		logger.info('[WorkItemLock] TTL expired, releasing in-memory lock', {
			projectId,
			workItemId,
			agentType,
		});
		return 0;
	}
	return entry.count;
}

/**
 * Check whether a work item is currently locked for the given agent type.
 *
 * Locked when the same agent type already has MAX_SAME_TYPE_PER_WORK_ITEM
 * agents running or enqueued. Different agent types are NOT blocked — they
 * can run concurrently on the same work item (spec 007).
 */
export async function isWorkItemLocked(
	projectId: string,
	workItemId: string,
	agentType: string,
): Promise<{ locked: boolean; reason?: string }> {
	const inMemorySameType = getInMemorySameTypeCount(projectId, workItemId, agentType);

	// Short-circuit: in-memory alone proves locked for same type
	if (inMemorySameType >= MAX_SAME_TYPE_PER_WORK_ITEM) {
		return {
			locked: true,
			reason: `in-memory same-type: ${inMemorySameType} enqueued (max ${MAX_SAME_TYPE_PER_WORK_ITEM} per type)`,
		};
	}

	// DB check — same-type only, ignore runs older than 2× worker timeout
	const maxAgeMs = 2 * routerConfig.workerTimeoutMs;
	const dbSameType = await countActiveRuns({ projectId, workItemId, agentType, maxAgeMs });

	const effectiveSameType = Math.max(dbSameType, inMemorySameType);
	if (effectiveSameType >= MAX_SAME_TYPE_PER_WORK_ITEM) {
		return {
			locked: true,
			reason: `same-type: ${dbSameType} running, ${inMemorySameType} enqueued (max ${MAX_SAME_TYPE_PER_WORK_ITEM} per type)`,
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
