/**
 * Claude subscription failover after a worker exits with code 3 (rate-limited).
 *
 * Requeues the job on another subscription, or — when every subscription is
 * exhausted — schedules a delayed retry for the earliest reset. Delayed retries
 * hold no lock while waiting; subscription-admission.ts takes it at fire time.
 */

import {
	getEarliestEligibleAt,
	selectBestSubscription,
} from '../db/repositories/subscriptionsRepository.js';
import { captureException } from '../sentry.js';
import { logger } from '../utils/logging.js';
import { activeWorkers } from './active-workers.js';
import { markAgentTypeEnqueued } from './agent-type-lock.js';
import { addJob, type CascadeJob, getPendingCoalescedJobData, jobQueue } from './queue.js';
import { markWorkItemEnqueued } from './work-item-lock.js';

const REQUEUABLE_TYPES = new Set(['trello', 'jira', 'github', 'linear', 'sentry']);
const MIN_DELAY_MS = 60_000;
const UNKNOWN_RESET_DELAY_MS = 60 * 60 * 1000;
const MAX_DELAYED_RETRIES = 3;
/** Spread retries over one maximum run (default watchdogTimeoutMs). */
const RETRY_JITTER_MS = 30 * 60 * 1000;
/** Only the delayed-retry path uses this job-name prefix; admission keys on it. */
export const DELAYED_RETRY_NAME_PREFIX = 'subrl_';

export type FailoverData = CascadeJob & {
	excludedSubscriptionIds?: number[];
	subscriptionDelayedRetries?: number;
};

/** Returns a callback the exit handler must run AFTER cleanupWorker, or undefined. */
export type RateLimitExitHandler = (jobId: string) => Promise<(() => void) | undefined>;

export const handleRateLimitExit: RateLimitExitHandler = async (jobId) => {
	const worker = activeWorkers.get(jobId);
	if (!worker?.subscriptionId || !worker.projectId) return undefined;
	const data = worker.job as FailoverData;
	if (!REQUEUABLE_TYPES.has(data.type)) {
		logger.warn('[Failover] Job type not requeuable; run stays failed', {
			jobId,
			type: data.type,
		});
		return undefined;
	}

	const excluded = [...new Set([...(data.excludedSubscriptionIds ?? []), worker.subscriptionId])];
	const next = await selectBestSubscription(worker.projectId, excluded);

	if (next) {
		const newId = await addJob({
			...data,
			excludedSubscriptionIds: excluded,
		} as unknown as CascadeJob);
		logger.info('[Failover] Requeued on another subscription', {
			jobId,
			newJobId: newId,
			from: worker.subscriptionId,
			candidate: next.id,
		});
		// Captured now: cleanupWorker deletes the activeWorkers entry before the callback runs.
		const { projectId, workItemId, agentType } = worker;
		return () => remarkLocks({ projectId, workItemId, agentType });
	}

	const retries = data.subscriptionDelayedRetries ?? 0;
	if (retries >= MAX_DELAYED_RETRIES) {
		const err = new Error(
			'Claude subscriptions exhausted; delayed-retry budget spent, event dropped',
		);
		logger.error('[Failover] All subscriptions exhausted, retry budget spent', { jobId, retries });
		captureException(err, {
			tags: { source: 'subscription_failover_budget' },
			extra: { jobId, projectId: worker.projectId, retries },
		});
		return undefined;
	}

	// Dedup only when the job has a work item; distinct jobs without one must never share a name.
	const name = worker.workItemId
		? `${DELAYED_RETRY_NAME_PREFIX}${worker.projectId}_${worker.workItemId}_${worker.agentType ?? 'none'}`
		: `${DELAYED_RETRY_NAME_PREFIX}${jobId}`;
	if (worker.workItemId && (await getPendingCoalescedJobData(name))) {
		logger.info('[Failover] Delayed retry already pending for this work item', { jobId, name });
		return undefined;
	}
	const eligibleAt = await getEarliestEligibleAt(worker.projectId);
	const base = Math.max(
		MIN_DELAY_MS,
		eligibleAt ? eligibleAt.getTime() - Date.now() : UNKNOWN_RESET_DELAY_MS,
	);
	const delay = base + Math.floor(Math.random() * RETRY_JITTER_MS);
	const newJobId = `${DELAYED_RETRY_NAME_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
	await jobQueue.add(
		name,
		{
			...data,
			excludedSubscriptionIds: [],
			subscriptionDelayedRetries: retries + 1,
		} as unknown as CascadeJob,
		{ jobId: newJobId, delay },
	);
	logger.info('[Failover] All subscriptions exhausted, delayed retry scheduled', {
		jobId,
		newJobId,
		delayMs: delay,
	});
	return undefined;
};

/** Runs after cleanupWorker released the original slot, so a fresh {count: 1, now} survives. */
function remarkLocks(w: { projectId?: string; workItemId?: string; agentType?: string }): void {
	if (w.projectId && w.workItemId && w.agentType) {
		markWorkItemEnqueued(w.projectId, w.workItemId, w.agentType);
	}
	if (w.projectId && w.agentType) markAgentTypeEnqueued(w.projectId, w.agentType);
}
