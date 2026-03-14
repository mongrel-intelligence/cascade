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
import {
	checkAgentTypeConcurrency,
	markAgentTypeEnqueued,
	markRecentlyDispatched,
} from './agent-type-lock.js';
import type { RouterPlatformAdapter } from './platform-adapter.js';
import { addJob } from './queue.js';
import { isWorkItemLocked, markWorkItemEnqueued } from './work-item-lock.js';

export interface ProcessRouterWebhookResult {
	/** Whether the event was of a processable type for this platform. */
	shouldProcess: boolean;
	/** The resolved project identifier, if any. */
	projectId?: string;
	/** Human-readable explanation of why the event was processed or skipped. */
	decisionReason?: string;
}

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
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: webhook pipeline with sequential guard checks
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

	logger.info(`${adapter.type} trigger matched`, {
		agentType: result.agentType || '(no agent)',
		workItemId: event.workItemId,
		projectId: project.id,
	});

	// GitHub special case: no-agent triggers (pr-merged, pr-ready-to-merge)
	// dispatch already performed PM operations — no job queuing needed
	if (!result.agentType) {
		logger.info('Trigger completed without agent (PM operation done)');
		return {
			shouldProcess: true,
			projectId: project.id,
			decisionReason: 'Trigger completed without agent (PM operation)',
		};
	}

	// Step 8: Work-item concurrency lock
	if (result.workItemId) {
		const lockStatus = await isWorkItemLocked(project.id, result.workItemId, result.agentType);
		if (lockStatus.locked) {
			result.onBlocked?.();
			logger.info(`Skipping ${adapter.type} job — work item already locked`, {
				projectId: project.id,
				workItemId: result.workItemId,
				agentType: result.agentType,
				reason: lockStatus.reason,
			});
			return {
				shouldProcess: true,
				projectId: project.id,
				decisionReason: `Work item locked: ${lockStatus.reason ?? 'active run exists'}`,
			};
		}
	}

	// Step 8b: Agent-type concurrency limit
	let agentTypeMaxConcurrency: number | null = null;
	if (result.agentType) {
		const concurrencyCheck = await checkAgentTypeConcurrency(
			project.id,
			result.agentType,
			adapter.type,
		);
		agentTypeMaxConcurrency = concurrencyCheck.maxConcurrency;
		if (concurrencyCheck.blocked) {
			result.onBlocked?.();
			return {
				shouldProcess: true,
				projectId: project.id,
				decisionReason: 'Agent type concurrency limit reached',
			};
		}
	}

	try {
		// Step 9: Post acknowledgment comment — ack info is now available at build time
		// Pass the full triggerResult so PM-focused agents (e.g. backlog-manager) can
		// route the ack to the PM tool (Trello/JIRA card) instead of a GitHub PR.
		const ackResult = await adapter.postAck(event, payload, project, result.agentType, result);
		if (ackResult?.commentId != null) {
			logger.info(`${adapter.type} ack comment posted`, {
				ackCommentId: ackResult.commentId,
				workItemId: event.workItemId,
			});
		} else {
			logger.debug(
				`${adapter.type} ack returned no comment ID (worker will run without pre-seeded comment)`,
				{
					workItemId: event.workItemId,
				},
			);
		}

		// Step 10: Build job with ack info embedded
		const job = adapter.buildJob(event, payload, project, result, ackResult);

		// Step 11: Fire optional pre-actions (fire-and-forget)
		adapter.firePreActions?.(job, payload);

		// Step 12: Enqueue — job is now durable in Redis
		const jobId = await addJob(job);
		if (result.workItemId) {
			markWorkItemEnqueued(project.id, result.workItemId, result.agentType);
		}
		if (result.agentType && agentTypeMaxConcurrency !== null) {
			markRecentlyDispatched(project.id, result.agentType);
			markAgentTypeEnqueued(project.id, result.agentType);
		}
		logger.info(`${adapter.type} job queued`, {
			jobId,
			eventType: event.eventType,
		});
	} catch (err) {
		result.onBlocked?.();
		logger.error(`Failed to queue ${adapter.type} job`, {
			error: String(err),
			eventType: event.eventType,
			workItemId: event.workItemId,
		});
		return {
			shouldProcess: true,
			projectId: project.id,
			decisionReason: 'Failed to enqueue job to Redis',
		};
	}

	return {
		shouldProcess: true,
		projectId: project.id,
		decisionReason: `Job queued: ${result.agentType} agent for work item ${event.workItemId ?? '(unknown)'}`,
	};
}
