/**
 * Short-window coalescing for PM create→update webhook sequences.
 *
 * Problem: JIRA emits two webhooks when a user creates an issue in a non-default
 * workflow column — `jira:issue_created` (with the workflow's initial status)
 * followed ~hundreds of ms later by `jira:issue_updated` (transitioning to the
 * target column). Without coalescing, both webhooks fire different agents on
 * the same work item.
 *
 * This module lets a create trigger register a pending entry keyed by
 * `${projectId}:${workItemId}`. An incoming update trigger for the same key
 * clears the entry, superseding the create. If the window elapses with no
 * update, the create proceeds normally.
 *
 * In-memory state is sufficient — a router restart during the ~2s window
 * means the pending create is lost, but the update webhook (which arrives
 * independently) will still fire.
 */

type PendingEntry = {
	timer: ReturnType<typeof setTimeout>;
	resolve: (outcome: 'proceed' | 'superseded') => void;
};

const pending = new Map<string, PendingEntry>();

/**
 * Register a pending create for the given key. Returns a promise that resolves
 * after `ttlMs` with `'proceed'` if still pending, or earlier with
 * `'superseded'` if `clearPendingCreate(key)` is called or another
 * `registerPendingCreate(key, …)` supersedes it.
 *
 * `ttlMs === 0` resolves immediately to `'proceed'` (coalescing disabled).
 */
export function registerPendingCreate(
	key: string,
	ttlMs: number,
): Promise<'proceed' | 'superseded'> {
	if (ttlMs <= 0) {
		return Promise.resolve('proceed');
	}

	// Supersede any existing entry for the same key.
	const existing = pending.get(key);
	if (existing) {
		clearTimeout(existing.timer);
		existing.resolve('superseded');
		pending.delete(key);
	}

	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			const entry = pending.get(key);
			if (entry && entry.resolve === resolve) {
				pending.delete(key);
			}
			resolve('proceed');
		}, ttlMs);
		pending.set(key, { timer, resolve });
	});
}

/**
 * Clear a pending create, causing its registration promise to resolve with
 * `'superseded'`. No-op if no entry exists for the key.
 */
export function clearPendingCreate(key: string): void {
	const entry = pending.get(key);
	if (!entry) return;
	clearTimeout(entry.timer);
	pending.delete(key);
	entry.resolve('superseded');
}

/**
 * Test-only: drop all pending entries without resolving their promises.
 * Used by unit tests between cases to ensure isolation.
 */
export function __resetCoalesceWindowForTests(): void {
	for (const entry of pending.values()) {
		clearTimeout(entry.timer);
	}
	pending.clear();
}

/**
 * Read the configured window duration in milliseconds. `0` disables coalescing.
 */
export function getCoalesceWindowMs(): number {
	const raw = process.env.PM_CREATE_COALESCE_WINDOW_MS;
	if (raw === undefined) return 2000;
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n) || n < 0) return 2000;
	return n;
}
