import { getCoalesceWindowMs } from '../pm/coalesce-config.js';
import { captureException } from '../sentry.js';
import type { TriggerResult } from '../types/index.js';
import { logger } from '../utils/logging.js';
import { clearAgentTypeEnqueued, clearRecentlyDispatched } from './agent-type-lock.js';
import type { RouterProjectConfig } from './config.js';
import type { ParsedWebhookEvent, RouterPlatformAdapter } from './platform-adapter.js';
import { addJob, getPendingCoalescedJobData, scheduleCoalescedJob } from './queue.js';
import {
	checkDispatchLocks,
	markCoalescedDispatchEnqueued,
	markImmediateDispatchEnqueued,
} from './webhook-dispatch-locks.js';
import { clearWorkItemEnqueued } from './work-item-lock.js';

export interface ProcessRouterWebhookResult {
	/** Whether the event was of a processable type for this platform. */
	shouldProcess: boolean;
	/** The resolved project identifier, if any. */
	projectId?: string;
	/** Human-readable explanation of why the event was processed or skipped. */
	decisionReason?: string;
}

/**
 * Pick the most specific work-item label for a webhook log decisionReason.
 *
 * Order: result.workItemId > `PR #<result.prNumber>` > event.workItemId > `(unknown)`.
 */
export function resolveWorkItemLabel(result: TriggerResult, event: ParsedWebhookEvent): string {
	if (result.workItemId) return result.workItemId;
	if (typeof result.prNumber === 'number') return `PR #${result.prNumber}`;
	return event.workItemId ?? '(unknown)';
}

export async function handleTriggerOutcome({
	adapter,
	event,
	payload,
	project,
	result,
}: {
	adapter: RouterPlatformAdapter;
	event: ParsedWebhookEvent;
	payload: unknown;
	project: RouterProjectConfig;
	result: TriggerResult;
}): Promise<ProcessRouterWebhookResult> {
	if (result.skipReason && result.agentType === null) {
		return handleStructuredSkip({
			adapterType: adapter.type,
			event,
			projectId: project.id,
			result,
		});
	}

	if (result.deferredRecheck && result.agentType === null) {
		return handleDeferredRecheck({ adapter, event, payload, project, result });
	}

	logger.info(`${adapter.type} trigger matched`, {
		agentType: result.agentType || '(no agent)',
		workItemId: event.workItemId,
		projectId: project.id,
	});

	const coalesced = await maybeHandleCoalescedDispatch({
		adapter,
		event,
		payload,
		project,
		result,
	});
	if (coalesced) return coalesced;

	if (!result.agentType) {
		logger.info('Trigger completed without agent (PM operation done)');
		return {
			shouldProcess: true,
			projectId: project.id,
			decisionReason: 'Trigger completed without agent (PM operation)',
		};
	}

	return handleImmediateDispatch({
		adapter,
		event,
		payload,
		project,
		result: result as TriggerResult & { agentType: string },
	});
}

function handleStructuredSkip({
	adapterType,
	event,
	projectId,
	result,
}: {
	adapterType: string;
	event: ParsedWebhookEvent;
	projectId: string;
	result: TriggerResult;
}): ProcessRouterWebhookResult {
	if (!result.skipReason) {
		throw new Error('handleStructuredSkip requires result.skipReason');
	}
	logger.info(`${adapterType} trigger self-skipped`, {
		handler: result.skipReason.handler,
		message: result.skipReason.message,
		eventType: event.eventType,
		workItemId: event.workItemId,
		projectId,
	});
	return {
		shouldProcess: true,
		projectId,
		decisionReason: `Trigger ${result.skipReason.handler} skipped: ${result.skipReason.message}`,
	};
}

async function handleDeferredRecheck({
	adapter,
	event,
	payload,
	project,
	result,
}: {
	adapter: RouterPlatformAdapter;
	event: ParsedWebhookEvent;
	payload: unknown;
	project: RouterProjectConfig;
	result: TriggerResult;
}): Promise<ProcessRouterWebhookResult> {
	if (!result.deferredRecheck) {
		throw new Error('handleDeferredRecheck requires result.deferredRecheck');
	}
	const job = adapter.buildJob(event, payload, project, result, undefined);
	try {
		await scheduleCoalescedJob(
			job,
			result.deferredRecheck.coalesceKey,
			result.deferredRecheck.delayMs,
		);
		logger.info(`${adapter.type} deferred re-check scheduled`, {
			coalesceKey: result.deferredRecheck.coalesceKey,
			delayMs: result.deferredRecheck.delayMs,
			projectId: project.id,
		});
	} catch (err) {
		captureException(err instanceof Error ? err : new Error(String(err)), {
			tags: { source: 'deferred_recheck_schedule_failure' },
			extra: { coalesceKey: result.deferredRecheck.coalesceKey, projectId: project.id },
		});
		logger.error(`Failed to schedule deferred re-check for ${adapter.type} event`, {
			error: String(err),
			coalesceKey: result.deferredRecheck.coalesceKey,
		});
	}
	return {
		shouldProcess: true,
		projectId: project.id,
		decisionReason: `Deferred re-check scheduled: ${result.deferredRecheck.coalesceKey}`,
	};
}

async function maybeHandleCoalescedDispatch({
	adapter,
	event,
	payload,
	project,
	result,
}: {
	adapter: RouterPlatformAdapter;
	event: ParsedWebhookEvent;
	payload: unknown;
	project: RouterProjectConfig;
	result: TriggerResult;
}): Promise<ProcessRouterWebhookResult | null> {
	if (!result.coalesceKey || !result.agentType) return null;

	const windowMs = getCoalesceWindowMs();
	if (windowMs <= 0) return null;

	const job = adapter.buildJob(event, payload, project, result, undefined);
	if (job.type === 'trello' || job.type === 'jira' || job.type === 'linear') {
		job.pendingAck = true;
		job.ackContextHint = result.workItemTitle ?? undefined;
	}

	try {
		const pendingJobData = await getPendingCoalescedJobData(result.coalesceKey);
		const shouldIgnorePendingOwnLock = shouldIgnorePendingOwnLocks({
			pendingJobData,
			projectId: project.id,
			result: result as TriggerResult & { agentType: string },
		});

		const lockCheck = await checkDispatchLocks({
			adapterType: adapter.type,
			projectId: project.id,
			result: result as TriggerResult & { agentType: string },
			ignorePendingOwnLock: shouldIgnorePendingOwnLock,
		});
		if (lockCheck.blocked) {
			return {
				shouldProcess: true,
				projectId: project.id,
				decisionReason: lockCheck.decisionReason,
			};
		}

		const { superseded, supersededJobData } = await scheduleCoalescedJob(
			job,
			result.coalesceKey,
			windowMs,
		);

		if (superseded) {
			logger.info(`${adapter.type} coalesced dispatch superseded prior pending job`, {
				agentType: result.agentType,
				workItemId: result.workItemId,
				projectId: project.id,
				coalesceKey: result.coalesceKey,
			});
			releaseSupersededJobLocks(supersededJobData);
		} else {
			logger.info(`${adapter.type} coalesced dispatch scheduled`, {
				agentType: result.agentType,
				workItemId: result.workItemId,
				projectId: project.id,
				coalesceKey: result.coalesceKey,
				delayMs: windowMs,
			});
		}
	} catch (err) {
		result.onBlocked?.();
		captureException(err instanceof Error ? err : new Error(String(err)), {
			tags: { source: 'coalesce_schedule_failure' },
			extra: {
				projectId: project.id,
				workItemId: result.workItemId,
				agentType: result.agentType,
				coalesceKey: result.coalesceKey,
				adapterType: adapter.type,
			},
		});
		logger.error(`Failed to schedule coalesced ${adapter.type} job`, {
			error: String(err),
			coalesceKey: result.coalesceKey,
			workItemId: result.workItemId,
		});
		return {
			shouldProcess: true,
			projectId: project.id,
			decisionReason: 'Failed to schedule coalesced job to Redis',
		};
	}

	markCoalescedDispatchEnqueued({
		projectId: project.id,
		result: result as TriggerResult & { agentType: string },
	});

	return {
		shouldProcess: true,
		projectId: project.id,
		decisionReason: `Coalesced dispatch scheduled: ${result.agentType} agent for work item ${resolveWorkItemLabel(result, event)}`,
	};
}

function shouldIgnorePendingOwnLocks({
	pendingJobData,
	projectId,
	result,
}: {
	pendingJobData: Awaited<ReturnType<typeof getPendingCoalescedJobData>>;
	projectId: string;
	result: TriggerResult & { agentType: string };
}): boolean {
	if (!pendingJobData || pendingJobData.type === 'github' || pendingJobData.type === 'gitlab')
		return false;
	if (pendingJobData.projectId !== projectId) return false;

	const pendingResult = pendingJobData.triggerResult;
	if (pendingResult?.agentType !== result.agentType) return false;

	const pendingLockKey = pendingResult.lockKey ?? pendingResult.workItemId;
	const newLockKey = result.lockKey ?? result.workItemId;
	return pendingLockKey !== undefined && pendingLockKey === newLockKey;
}

function releaseSupersededJobLocks(
	supersededJobData: Awaited<ReturnType<typeof scheduleCoalescedJob>>['supersededJobData'],
): void {
	if (
		!supersededJobData ||
		supersededJobData.type === 'github' ||
		supersededJobData.type === 'gitlab'
	)
		return;

	const oldAgentType = supersededJobData.triggerResult?.agentType;
	const oldLockKey =
		supersededJobData.triggerResult?.lockKey ?? supersededJobData.triggerResult?.workItemId;
	if (!oldAgentType) return;

	if (oldLockKey) {
		clearWorkItemEnqueued(supersededJobData.projectId, oldLockKey, oldAgentType);
	}
	clearAgentTypeEnqueued(supersededJobData.projectId, oldAgentType);
	clearRecentlyDispatched(
		supersededJobData.projectId,
		oldAgentType,
		supersededJobData.triggerResult?.workItemId,
	);
}

async function handleImmediateDispatch({
	adapter,
	event,
	payload,
	project,
	result,
}: {
	adapter: RouterPlatformAdapter;
	event: ParsedWebhookEvent;
	payload: unknown;
	project: RouterProjectConfig;
	result: TriggerResult & { agentType: string };
}): Promise<ProcessRouterWebhookResult> {
	const lockCheck = await checkDispatchLocks({
		adapterType: adapter.type,
		projectId: project.id,
		result,
	});
	if (lockCheck.blocked) {
		return {
			shouldProcess: true,
			projectId: project.id,
			decisionReason: lockCheck.decisionReason,
		};
	}

	try {
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

		const job = adapter.buildJob(event, payload, project, result, ackResult);
		adapter.firePreActions?.(job, payload);
		const jobId = await addJob(job);
		markImmediateDispatchEnqueued({
			projectId: project.id,
			result,
			effectiveLockKey: lockCheck.effectiveLockKey,
			agentTypeMaxConcurrency: lockCheck.agentTypeMaxConcurrency,
		});
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
		decisionReason: `Job queued: ${result.agentType} agent for work item ${resolveWorkItemLabel(result, event)}`,
	};
}
