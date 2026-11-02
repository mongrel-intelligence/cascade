/**
 * Dispatch helper for polling.
 *
 * Dispatches synthetic events through the router pipeline and records
 * them in the dedup ledger. Handles deferred events (not recorded),
 * skipped events (recorded), and errors (not recorded, returns error).
 */

import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { pollingProcessedEvents } from '../db/schema/polling.js';
import type { RouterPlatformAdapter } from '../router/platform-adapter.js';
import { processRouterWebhook } from '../router/webhook-processor.js';
import type { ProcessRouterWebhookResult } from '../router/webhook-trigger-outcomes.js';
import type { TriggerRegistry } from '../triggers/registry.js';
import { logger } from '../utils/logging.js';

/** Event types that can be recorded in the ledger. */
export type PollingEventType =
	| 'check_suite'
	| 'status_changed'
	| 'pr_review'
	| 'merged_pr'
	| 'pr_conflict'
	| 'pr_conflict_checked'
	| 'ignored';

/** Result of a polling dispatch attempt. */
export interface PollingDispatchResult {
	/** Whether the event was recorded in the ledger. */
	recorded: boolean;
	/** Whether the dispatch was deferred for later re-check. */
	deferred: boolean;
	/** Whether a trigger handler skipped the event (still recorded). */
	skipped: boolean;
	/** Whether a job was enqueued to BullMQ. */
	enqueued: boolean;
	/** Error if the dispatch failed. */
	error?: Error;
}

/**
 * Dispatch a synthetic event through the router and record it in the ledger.
 *
 * Behavior by outcome:
 * - deferred=true: NOT recorded (will re-emit next cycle)
 * - skipReason set: recorded (final decision, no re-emit)
 * - successful dispatch: recorded
 * - dispatch error: NOT recorded (returns error)
 * - ledger write error: returns recorded=false but dispatch succeeded
 */
export async function dispatchAndRecord(
	projectId: string,
	provider: 'jira' | 'github',
	eventType: PollingEventType,
	dedupKey: string,
	syntheticEvent: unknown,
	adapter: RouterPlatformAdapter,
	triggerRegistry: TriggerRegistry,
): Promise<PollingDispatchResult> {
	// Step 1: Check if already in ledger (batch lookups should happen before
	// calling this, but single-event check is a safety net)
	const db = getDb();
	const existing = await db.query.pollingProcessedEvents.findFirst({
		where: and(
			eq(pollingProcessedEvents.projectId, projectId),
			eq(pollingProcessedEvents.provider, provider),
			eq(pollingProcessedEvents.dedupKey, dedupKey),
		),
	});

	if (existing) {
		logger.debug('Event already in ledger, skipping dispatch', { dedupKey });
		return { recorded: false, deferred: false, skipped: true, enqueued: false };
	}

	// Step 2: Dispatch through router
	let result: ProcessRouterWebhookResult;
	try {
		result = await processRouterWebhook(adapter, syntheticEvent, triggerRegistry);
	} catch (error) {
		logger.error('Dispatch failed', { dedupKey, error: String(error) });
		return {
			recorded: false,
			deferred: false,
			skipped: false,
			enqueued: false,
			error: error instanceof Error ? error : new Error(String(error)),
		};
	}

	// Step 3: Handle deferred events - do NOT record, will re-emit next cycle
	if (result.deferred) {
		logger.debug('Dispatch deferred, not recording in ledger', { dedupKey });
		return { recorded: false, deferred: true, skipped: false, enqueued: false };
	}

	// Step 4: Record to ledger for all other outcomes (including skips)
	// Skipped events are final decisions and should not be re-emitted
	let recorded = false;
	try {
		await getDb()
			.insert(pollingProcessedEvents)
			.values({
				projectId,
				provider,
				eventType,
				dedupKey,
			})
			.onConflictDoNothing();
		recorded = true;
	} catch (dbError) {
		logger.warn('Ledger write failed after dispatch', { dedupKey, error: String(dbError) });
		// Continue - dispatch succeeded even if ledger write failed
	}

	// Determine if job was enqueued (shouldProcess=true AND no skipReason)
	const enqueued = result.shouldProcess && !result.skipReason;

	return {
		recorded,
		deferred: false,
		skipped: !!result.skipReason,
		enqueued,
	};
}

/**
 * Record an event in the ledger without dispatching.
 * Used for cold start seeding and recording ignored/filtered events.
 */
export async function recordWithoutDispatch(
	projectId: string,
	provider: 'jira' | 'github',
	eventType: PollingEventType,
	dedupKey: string,
): Promise<boolean> {
	try {
		await getDb()
			.insert(pollingProcessedEvents)
			.values({
				projectId,
				provider,
				eventType,
				dedupKey,
			})
			.onConflictDoNothing();
		return true;
	} catch (error) {
		logger.warn('Failed to record event in ledger', { dedupKey, error: String(error) });
		return false;
	}
}

/**
 * Batch check which dedup keys already exist in the ledger.
 * Returns a Set of existing keys.
 */
export async function batchCheckLedger(
	projectId: string,
	provider: 'jira' | 'github',
	dedupKeys: string[],
): Promise<Set<string>> {
	if (dedupKeys.length === 0) {
		return new Set();
	}

	const existing = await getDb().query.pollingProcessedEvents.findMany({
		where: and(
			eq(pollingProcessedEvents.projectId, projectId),
			eq(pollingProcessedEvents.provider, provider),
			inArray(pollingProcessedEvents.dedupKey, dedupKeys),
		),
		columns: { dedupKey: true },
	});

	return new Set(existing.map((e) => e.dedupKey));
}

/**
 * Batch record multiple events in the ledger without dispatching.
 * Used for cold start seeding. Guards against empty arrays.
 */
export async function batchRecordWithoutDispatch(
	projectId: string,
	provider: 'jira' | 'github',
	events: Array<{ eventType: PollingEventType; dedupKey: string }>,
): Promise<number> {
	if (events.length === 0) {
		return 0;
	}

	try {
		const result = await getDb()
			.insert(pollingProcessedEvents)
			.values(
				events.map((e) => ({
					projectId,
					provider,
					eventType: e.eventType,
					dedupKey: e.dedupKey,
				})),
			)
			.onConflictDoNothing();

		return result.rowCount ?? events.length;
	} catch (error) {
		logger.warn('Failed to batch record events in ledger', {
			projectId,
			count: events.length,
			error: String(error),
		});
		return 0;
	}
}
