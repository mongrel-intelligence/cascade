/**
 * Action-level deduplication for duplicate webhook events.
 *
 * Some platforms (especially Trello) may deliver the same webhook event multiple
 * times within milliseconds (e.g., due to duplicate webhook registrations).
 * This module provides a short-lived in-memory cache to detect and skip duplicates
 * before expensive operations (ack posting, job enqueueing) are performed.
 *
 * The dedup window is intentionally short (60s) — long enough to catch rapid
 * duplicates but short enough to allow legitimate retries.
 */

const DEDUP_TTL_MS = 60 * 1000; // 60 seconds
const CLEANUP_THRESHOLD = 1000; // Trigger cleanup when map exceeds this size

const seenActions = new Map<string, number>();

/**
 * Check whether an action ID has already been processed within the TTL window.
 * Returns true if this is a duplicate that should be skipped.
 */
export function isDuplicateAction(actionId: string): boolean {
	const timestamp = seenActions.get(actionId);
	if (timestamp === undefined) return false;

	if (Date.now() - timestamp > DEDUP_TTL_MS) {
		seenActions.delete(actionId);
		return false;
	}
	return true;
}

/**
 * Mark an action ID as processed.
 * Call this immediately after `isDuplicateAction()` returns false.
 */
export function markActionProcessed(actionId: string): void {
	seenActions.set(actionId, Date.now());

	// Cleanup when map grows large
	if (seenActions.size > CLEANUP_THRESHOLD) {
		const now = Date.now();
		for (const [id, ts] of seenActions) {
			if (now - ts > DEDUP_TTL_MS) seenActions.delete(id);
		}
	}
}

/**
 * Clear all action records.
 * Called from `clearAllAgentTypeLocks()` for test isolation and shutdown.
 */
export function clearActionRecords(): void {
	seenActions.clear();
}
