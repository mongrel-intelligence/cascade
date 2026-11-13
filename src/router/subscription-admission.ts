/**
 * Fire-time admission for Claude subscription delayed retries.
 *
 * Kept apart from subscription-failover.ts so worker-manager.ts never loads
 * queue.ts through it. Imports only lock and env helpers.
 */

import type { Job } from 'bullmq';
import { logger } from '../utils/logging.js';
import { markAgentTypeEnqueued } from './agent-type-lock.js';
import type { CascadeJob } from './queue.js';
import { isWorkItemLocked, markWorkItemEnqueued } from './work-item-lock.js';
import { extractAgentType, extractProjectIdFromJob, extractWorkItemId } from './worker-env.js';

/** Must equal DELAYED_RETRY_NAME_PREFIX in subscription-failover.ts (duplicated to avoid importing queue.ts). */
const DELAYED_RETRY_NAME_PREFIX = 'subrl_';

/**
 * Called for every cascade-jobs job before spawning. Only jobs created by the
 * delayed-retry path are gated; everything else passes straight through.
 * A delayed retry held no lock while waiting: take it now, or drop the retry
 * if a same-type run already covers the work item.
 */
export async function admitDelayedRetry(job: Job<CascadeJob>): Promise<boolean> {
	const data = job.data as CascadeJob & { subscriptionDelayedRetries?: number };
	if (
		!job.name.startsWith(DELAYED_RETRY_NAME_PREFIX) ||
		(data.subscriptionDelayedRetries ?? 0) < 1
	) {
		return true;
	}

	let projectId: string | null | undefined;
	let workItemId: string | undefined;
	let agentType: string | undefined;
	try {
		projectId = await extractProjectIdFromJob(data);
		workItemId = extractWorkItemId(data);
		agentType = extractAgentType(data);
		if (!projectId || !agentType) return true;
		if (workItemId) {
			// The dispatch compensator cleared our marks after any failed attempt, so never ignore counts.
			const { locked, reason } = await isWorkItemLocked(projectId, workItemId, agentType, {
				ignoreInMemoryCount: 0,
			});
			if (locked) {
				logger.warn(
					'[Failover] Dropping delayed retry: work item already covered by a same-type run',
					{ jobId: job.id, projectId, workItemId, agentType, reason, attempt: job.attemptsMade },
				);
				return false;
			}
		}
	} catch (err) {
		// This throw fails the attempt and the compensator then clears one work-item mark and one
		// agent-type mark for this job. Take them first so the release removes ours, not another job's.
		if (projectId && agentType) {
			if (workItemId) markWorkItemEnqueued(projectId, workItemId, agentType);
			markAgentTypeEnqueued(projectId, agentType);
		}
		throw err;
	}

	if (workItemId) markWorkItemEnqueued(projectId, workItemId, agentType);
	markAgentTypeEnqueued(projectId, agentType);
	return true;
}
