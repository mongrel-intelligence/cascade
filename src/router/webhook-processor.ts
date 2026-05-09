/**
 * Generic router-side webhook processor.
 *
 * Implements the common pipeline:
 *   parse → filter → self-check → reaction → resolve config →
 *   credential scope + dispatch → ack → build job → pre-actions → queue
 *
 * Each platform provides a `RouterPlatformAdapter` that implements
 * the platform-specific steps. Mirrors the `processPMWebhook()` pattern
 * from `pm/webhook-handler.ts` but for the router (enqueue-only) path.
 */

import type { TriggerRegistry } from '../triggers/registry.js';
import { logger } from '../utils/logging.js';
import { isDuplicateAction, markActionProcessed } from './action-dedup.js';
import type { RouterPlatformAdapter } from './platform-adapter.js';
import {
	handleTriggerOutcome,
	type ProcessRouterWebhookResult,
} from './webhook-trigger-outcomes.js';

/**
 * Process a single incoming webhook through the full router pipeline.
 *
 * 1.  Parse payload into a normalized `ParsedWebhookEvent`
 * 2.  Action-level dedup (skip duplicate webhook deliveries)
 * 3.  Check if the event type is processable
 * 4.  Check for self-authored events (loop prevention)
 * 5.  Fire acknowledgment reaction (fire-and-forget)
 * 6.  Resolve project config
 * 7.  Dispatch triggers with platform credential scope
 * 8.  Work-item concurrency lock check
 * 9.  Post acknowledgment comment (ack info available at build time)
 * 10. Build job (with ack info embedded)
 * 11. Fire optional pre-actions (e.g. GitHub 👀 reaction)
 * 12. Enqueue job to Redis (durable)
 */
export async function processRouterWebhook(
	adapter: RouterPlatformAdapter,
	payload: unknown,
	triggerRegistry: TriggerRegistry,
): Promise<ProcessRouterWebhookResult> {
	// Step 1: Parse
	const event = await adapter.parseWebhook(payload);
	if (!event) {
		logger.debug(`Ignoring ${adapter.type} event (unparseable or not processable)`);
		return { shouldProcess: false, decisionReason: 'Event unparseable or not processable' };
	}

	// Step 2: Action-level deduplication (handles duplicate webhook deliveries)
	if (event.actionId) {
		if (isDuplicateAction(event.actionId)) {
			logger.info(`Ignoring duplicate ${adapter.type} action`, {
				actionId: event.actionId,
				eventType: event.eventType,
				workItemId: event.workItemId,
			});
			return { shouldProcess: false, decisionReason: 'Duplicate action' };
		}
		markActionProcessed(event.actionId);
	}

	// Step 3: Filter
	if (!adapter.isProcessableEvent(event)) {
		logger.debug(`Ignoring ${adapter.type} event`, { eventType: event.eventType });
		return {
			shouldProcess: false,
			decisionReason: `Event type not processable: ${event.eventType}`,
		};
	}

	// Step 4: Self-authored check
	if (await adapter.isSelfAuthored(event, payload)) {
		logger.info(`Ignoring self-authored ${adapter.type} event`, {
			eventType: event.eventType,
			projectIdentifier: event.projectIdentifier,
		});
		return { shouldProcess: true, decisionReason: 'Self-authored event (loop prevention)' };
	}

	// Step 5: Fire acknowledgment reaction (fire-and-forget)
	adapter.sendReaction(event, payload);

	// Step 6: Resolve project config
	const project = await adapter.resolveProject(event);
	if (!project) {
		logger.info(`No project config found for ${adapter.type} event`, {
			projectIdentifier: event.projectIdentifier,
		});
		return {
			shouldProcess: true,
			decisionReason: `No project config for identifier ${event.projectIdentifier ?? '(unknown)'}`,
		};
	}

	// Step 7: Dispatch triggers with credential scope
	let result = null;
	try {
		result = await adapter.dispatchWithCredentials(event, payload, project, triggerRegistry);
	} catch (err) {
		logger.warn(`${adapter.type} trigger dispatch failed (non-fatal)`, {
			error: String(err),
			projectId: project.id,
		});
	}

	if (!result) {
		logger.info(`No trigger matched for ${adapter.type} event`, {
			eventType: event.eventType,
			workItemId: event.workItemId,
		});
		return {
			shouldProcess: true,
			projectId: project.id,
			decisionReason: 'No trigger matched for event',
		};
	}

	return handleTriggerOutcome({ adapter, event, payload, project, result });
}
