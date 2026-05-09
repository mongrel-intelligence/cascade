import { captureException } from '../sentry.js';
import type { TriggerResult } from '../types/index.js';
import { logger } from '../utils/logging.js';
import {
	checkAgentTypeConcurrency,
	markAgentTypeEnqueued,
	markRecentlyDispatched,
} from './agent-type-lock.js';
import { classifyLockState } from './lock-state-classifier.js';
import { isWorkItemLocked, markWorkItemEnqueued } from './work-item-lock.js';

export interface DispatchLockCheckResult {
	blocked: boolean;
	decisionReason?: string;
	effectiveLockKey?: string;
	agentTypeMaxConcurrency: number | null;
}

export async function checkDispatchLocks({
	adapterType,
	projectId,
	result,
}: {
	adapterType: string;
	projectId: string;
	result: TriggerResult & { agentType: string };
}): Promise<DispatchLockCheckResult> {
	const effectiveLockKey = result.lockKey ?? result.workItemId;
	if (effectiveLockKey) {
		const lockStatus = await isWorkItemLocked(projectId, effectiveLockKey, result.agentType);
		if (lockStatus.locked) {
			result.onBlocked?.();
			logger.info(`Skipping ${adapterType} job — work item already locked`, {
				source: adapterType,
				projectId,
				workItemId: effectiveLockKey,
				blockedAgentType: result.agentType,
				reason: lockStatus.reason,
			});
			const classification = await classifyLockState({
				projectId,
				workItemId: effectiveLockKey,
				agentType: result.agentType,
			});
			const reasonSuffix = lockStatus.reason ?? 'active run exists';
			if (classification === 'wedged') {
				captureException(
					new Error(
						`wedged work-item lock: projectId=${projectId} workItemId=${effectiveLockKey} agentType=${result.agentType}`,
					),
					{
						tags: { source: 'wedged_lock_canary' },
						extra: {
							projectId,
							workItemId: effectiveLockKey,
							agentType: result.agentType,
							reason: lockStatus.reason,
						},
					},
				);
				return {
					blocked: true,
					decisionReason: `Work item locked (no active dispatch): ${reasonSuffix}`,
					agentTypeMaxConcurrency: null,
				};
			}
			return {
				blocked: true,
				decisionReason: `Awaiting worker slot: ${reasonSuffix}`,
				agentTypeMaxConcurrency: null,
			};
		}
	}

	const concurrencyCheck = await checkAgentTypeConcurrency(
		projectId,
		result.agentType,
		adapterType,
		result.workItemId,
	);
	if (concurrencyCheck.blocked) {
		result.onBlocked?.();
		return {
			blocked: true,
			decisionReason: 'Agent type concurrency limit reached',
			effectiveLockKey,
			agentTypeMaxConcurrency: concurrencyCheck.maxConcurrency,
		};
	}

	return {
		blocked: false,
		effectiveLockKey,
		agentTypeMaxConcurrency: concurrencyCheck.maxConcurrency,
	};
}

export function markImmediateDispatchEnqueued({
	projectId,
	result,
	effectiveLockKey,
	agentTypeMaxConcurrency,
}: {
	projectId: string;
	result: TriggerResult & { agentType: string };
	effectiveLockKey?: string;
	agentTypeMaxConcurrency: number | null;
}): void {
	if (effectiveLockKey) {
		markWorkItemEnqueued(projectId, effectiveLockKey, result.agentType);
	}
	if (agentTypeMaxConcurrency !== null) {
		markRecentlyDispatched(projectId, result.agentType, result.workItemId);
		markAgentTypeEnqueued(projectId, result.agentType);
	}
}

export function markCoalescedDispatchEnqueued({
	projectId,
	result,
}: {
	projectId: string;
	result: TriggerResult & { agentType: string };
}): void {
	const coalescedLockKey = result.lockKey ?? result.workItemId;
	if (coalescedLockKey) {
		markWorkItemEnqueued(projectId, coalescedLockKey, result.agentType);
	}
	markRecentlyDispatched(projectId, result.agentType, result.workItemId);
	markAgentTypeEnqueued(projectId, result.agentType);
}
