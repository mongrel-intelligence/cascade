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
import type { RouterPlatformAdapter } from './platform-adapter.js';
import { addJob } from './queue.js';
import { isWorkItemLocked, markWorkItemEnqueued } from './work-item-lock.js';

export interface ProcessRouterWebhookResult {
	/** Whether the event was of a processable type for this platform. */
	shouldProcess: boolean;
	/** The resolved project identifier, if any. */
	projectId?: string;
}

/**
 * Process a single incoming webhook through the full router pipeline.
 *
 * 1. Parse payload into a normalized `ParsedWebhookEvent`
 * 2. Check if the event type is processable
 * 3. Check for self-authored events (loop prevention)
 * 4. Fire acknowledgment reaction (fire-and-forget)
 * 5. Resolve project config
 * 6. Dispatch triggers with platform credential scope
 * 7. Work-item concurrency lock check
 * 8. Post acknowledgment comment
 * 9. Build and enqueue job
 * 10. Fire optional pre-actions (e.g. GitHub 👀 reaction)
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
		return { shouldProcess: false };
	}

	// Step 2: Filter
	if (!adapter.isProcessableEvent(event)) {
		logger.debug(`Ignoring ${adapter.type} event`, { eventType: event.eventType });
		return { shouldProcess: false };
	}

	// Step 3: Self-authored check
	if (await adapter.isSelfAuthored(event, payload)) {
		logger.info(`Ignoring self-authored ${adapter.type} event`, {
			eventType: event.eventType,
			projectIdentifier: event.projectIdentifier,
		});
		return { shouldProcess: true };
	}

	// Step 4: Fire acknowledgment reaction (fire-and-forget)
	adapter.sendReaction(event, payload);

	// Step 5: Resolve project config
	const project = await adapter.resolveProject(event);
	if (!project) {
		logger.info(`No project config found for ${adapter.type} event`, {
			projectIdentifier: event.projectIdentifier,
		});
		return { shouldProcess: true };
	}

	// Step 6: Dispatch triggers with credential scope
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
		return { shouldProcess: true, projectId: project.id };
	}

	logger.info(`${adapter.type} trigger matched`, {
		agentType: result.agentType || '(no agent)',
		workItemId: event.workItemId,
		projectId: project.id,
	});

	// GitHub special case: no-agent triggers (pr-merged, pr-ready-to-merge)
	// dispatch already performed PM operations — no job queuing needed
	if (!result.agentType) {
		logger.info('Trigger completed without agent (PM operation done)');
		return { shouldProcess: true, projectId: project.id };
	}

	// Step 7: Work-item concurrency lock
	if (result.workItemId) {
		const lockStatus = await isWorkItemLocked(project.id, result.workItemId);
		if (lockStatus.locked) {
			logger.info(`Skipping ${adapter.type} job — work item already locked`, {
				projectId: project.id,
				workItemId: result.workItemId,
				agentType: result.agentType,
				reason: lockStatus.reason,
			});
			return { shouldProcess: true, projectId: project.id };
		}
	}

	// Step 8: Post acknowledgment comment
	const ackResult = await adapter.postAck(event, payload, project, result.agentType);
	const ackCommentId = ackResult?.commentId;
	const ackMessage = ackResult?.message;

	// Step 9: Build job
	const job = adapter.buildJob(event, payload, project, result, ackCommentId, ackMessage);

	// Step 10: Fire optional pre-actions (fire-and-forget)
	adapter.firePreActions?.(job, payload);

	// Enqueue
	try {
		const jobId = await addJob(job);
		if (result.workItemId) {
			markWorkItemEnqueued(project.id, result.workItemId);
		}
		logger.info(`${adapter.type} job queued`, {
			jobId,
			eventType: event.eventType,
			ackCommentId,
		});
	} catch (err) {
		logger.error(`Failed to queue ${adapter.type} job`, {
			error: String(err),
			eventType: event.eventType,
			workItemId: event.workItemId,
		});
	}

	return { shouldProcess: true, projectId: project.id };
}
