/**
 * Agent-type concurrency lock for the router.
 *
 * Two layers:
 * 1. Concurrency lock (in-memory + DB) — prevents multiple instances of the
 *    same agent type running for the same project. Cleared on completion.
 * 2. Trigger-level dedup (in-memory, short TTL) — suppresses re-triggers
 *    within a 60-second window after the first dispatch. NOT cleared on
 *    completion (TTL-only). Handles sequential batch webhooks in server mode.
 */

import { countActiveRunsForAgentType } from '../db/repositories/runsRepository.js';
import { getMaxConcurrency } from '../db/repositories/settingsRepository.js';
import { logger } from '../utils/logging.js';
import { clearActionRecords } from './action-dedup.js';
import { routerConfig } from './config.js';

// ============================================================================
// Layer 1: Agent-Type Concurrency Lock (cleared on completion)
// ============================================================================

const CONCURRENCY_TTL_MS = 30 * 60 * 1000; // 30 minutes safety net

interface ConcurrencyEntry {
	timestamp: number;
	count: number;
}

const concurrencyMap = new Map<string, ConcurrencyEntry>();

function makeKey(projectId: string, agentType: string): string {
	return `${projectId}:${agentType}`;
}

/**
 * Check whether an agent type is at its concurrency limit for a project.
 * Fast path: in-memory map. Fallback: DB count of running agent_runs.
 */
export async function isAgentTypeLocked(
	projectId: string,
	agentType: string,
	maxConcurrency: number,
): Promise<{ locked: boolean; reason?: string }> {
	const key = makeKey(projectId, agentType);

	// Lazy TTL cleanup
	const entry = concurrencyMap.get(key);
	if (entry) {
		if (Date.now() - entry.timestamp > CONCURRENCY_TTL_MS) {
			concurrencyMap.delete(key);
			logger.info('[AgentTypeLock] TTL expired, releasing in-memory lock', {
				projectId,
				agentType,
			});
		} else if (entry.count >= maxConcurrency) {
			return {
				locked: true,
				reason: `in-memory: ${entry.count} enqueued (max ${maxConcurrency})`,
			};
		}
	}

	// DB check — ignore runs older than 2× worker timeout (stale/orphaned)
	const maxAgeMs = 2 * routerConfig.workerTimeoutMs;
	const activeCount = await countActiveRunsForAgentType(projectId, agentType, maxAgeMs);
	const inMemoryCount =
		entry && Date.now() - entry.timestamp <= CONCURRENCY_TTL_MS ? entry.count : 0;
	const effectiveCount = Math.max(activeCount, inMemoryCount);

	if (effectiveCount >= maxConcurrency) {
		return {
			locked: true,
			reason: `${activeCount} running, ${inMemoryCount} enqueued (max ${maxConcurrency})`,
		};
	}

	return { locked: false };
}

/**
 * Mark an agent type as enqueued (in-memory, fast path).
 * Called after dispatch succeeds.
 */
export function markAgentTypeEnqueued(projectId: string, agentType: string): void {
	const key = makeKey(projectId, agentType);
	const existing = concurrencyMap.get(key);
	if (existing && Date.now() - existing.timestamp <= CONCURRENCY_TTL_MS) {
		existing.count += 1;
		existing.timestamp = Date.now();
	} else {
		concurrencyMap.set(key, { timestamp: Date.now(), count: 1 });
	}
}

/**
 * Clear one enqueued slot for an agent type.
 * Called when a worker exits (router mode) or agent completes (server mode).
 */
export function clearAgentTypeEnqueued(projectId: string, agentType: string): void {
	const key = makeKey(projectId, agentType);
	const entry = concurrencyMap.get(key);
	if (entry) {
		entry.count -= 1;
		if (entry.count <= 0) {
			concurrencyMap.delete(key);
		}
	}
}

/**
 * Clear all in-memory concurrency locks (used on shutdown / detachAll).
 */
export function clearAllAgentTypeLocks(): void {
	concurrencyMap.clear();
	dedupMap.clear();
	clearActionRecords();
}

// ============================================================================
// Layer 2: Trigger-Level Dedup (short TTL, NOT cleared on completion)
// ============================================================================

const DEDUP_TTL_MS = 60 * 1000; // 60 seconds

const dedupMap = new Map<string, number>();

/**
 * Check whether an agent type was recently dispatched for a project.
 * Returns true if a dispatch happened within the dedup TTL window.
 */
export function wasRecentlyDispatched(projectId: string, agentType: string): boolean {
	const key = makeKey(projectId, agentType);
	const timestamp = dedupMap.get(key);
	if (timestamp === undefined) return false;

	if (Date.now() - timestamp > DEDUP_TTL_MS) {
		dedupMap.delete(key);
		return false;
	}
	return true;
}

/**
 * Mark an agent type as recently dispatched for a project.
 * The mark expires after DEDUP_TTL_MS and is NOT cleared on completion.
 */
export function markRecentlyDispatched(projectId: string, agentType: string): void {
	const key = makeKey(projectId, agentType);
	dedupMap.set(key, Date.now());

	// Periodic cleanup: evict expired entries when map grows large
	if (dedupMap.size > 100) {
		const now = Date.now();
		for (const [k, ts] of dedupMap) {
			if (now - ts > DEDUP_TTL_MS) dedupMap.delete(k);
		}
	}
}

// ============================================================================
// Combined Concurrency Check (shared by all webhook handlers)
// ============================================================================

/**
 * Check agent-type concurrency limit for a (projectId, agentType) pair.
 * Combines DB config lookup, dedup check, and concurrency lock.
 *
 * Returns `{ maxConcurrency, blocked }`:
 * - `maxConcurrency === null` means no limit is configured
 * - `blocked === true` means the agent should be skipped
 */
export async function checkAgentTypeConcurrency(
	projectId: string,
	agentType: string,
	logLabel?: string,
): Promise<{ maxConcurrency: number | null; blocked: boolean }> {
	let maxConcurrency: number | null;
	try {
		maxConcurrency = await getMaxConcurrency(projectId, agentType);
	} catch (err) {
		logger.warn('[AgentTypeLock] Failed to check max concurrency, proceeding without limit', {
			projectId,
			agentType,
			error: String(err),
		});
		return { maxConcurrency: null, blocked: false };
	}
	if (maxConcurrency === null) return { maxConcurrency: null, blocked: false };

	if (wasRecentlyDispatched(projectId, agentType)) {
		logger.info(`${logLabel ?? 'Agent'} recently dispatched, skipping (dedup)`, {
			projectId,
			agentType,
		});
		return { maxConcurrency, blocked: true };
	}
	const lockStatus = await isAgentTypeLocked(projectId, agentType, maxConcurrency);
	if (lockStatus.locked) {
		logger.info(`${logLabel ?? 'Agent'} type concurrency limit reached, skipping`, {
			projectId,
			agentType,
			reason: lockStatus.reason,
		});
		return { maxConcurrency, blocked: true };
	}
	return { maxConcurrency, blocked: false };
}
