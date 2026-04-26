/**
 * Lock-state classifier.
 *
 * Given a held in-memory work-item lock for `(projectId, workItemId, agentType)`,
 * decide whether the lock corresponds to actual dispatch state or whether it
 * has been stranded by a dispatch failure that didn't compensate.
 *
 * Returns one of:
 *   - 'awaiting-slot' — an active worker or a queued/waiting job matches the
 *     trio; the lock is healthy and the user-visible message should reflect
 *     "queued behind another run."
 *   - 'wedged' — neither correlation matches; the lock is stranded. After
 *     spec 015/1's compensator landed, this should never happen under normal
 *     operation. Its presence is a regression invariant: the caller is
 *     expected to capture it to Sentry as a canary.
 *
 * On classifier error (e.g. Redis hiccup during queue lookup), the result
 * defaults to 'awaiting-slot' to avoid mis-emitting the wedged canary on a
 * transient infrastructure blip.
 */

import { logger } from '../utils/logging.js';
import { getActiveWorkers } from './active-workers.js';
import type { CascadeJob } from './queue.js';
import { jobQueue } from './queue.js';
import { extractAgentType, extractProjectIdFromJob, extractWorkItemId } from './worker-env.js';

export type LockStateClassification = 'awaiting-slot' | 'wedged';

export interface LockStateInput {
	projectId: string;
	workItemId: string;
	agentType: string;
}

export async function classifyLockState(input: LockStateInput): Promise<LockStateClassification> {
	const { projectId, workItemId, agentType } = input;

	// 1. Active worker correlation — fast in-memory map lookup.
	const activeMatch = getActiveWorkers().some(
		(w) => w.projectId === projectId && w.workItemId === workItemId && w.agentType === agentType,
	);
	if (activeMatch) return 'awaiting-slot';

	// 2. BullMQ queue correlation — only if the lock is held without a
	//    matching active worker. Limited to waiting/active states (jobs that
	//    BullMQ might still pick up).
	try {
		const jobs = await jobQueue.getJobs(['waiting', 'active']);
		for (const job of jobs) {
			// `getJobs` returns `Job<CascadeJob>` per the queue's generic.
			const data = job.data as CascadeJob;
			const jobProjectId = await extractProjectIdFromJob(data);
			if (jobProjectId !== projectId) continue;
			if (extractWorkItemId(data) !== workItemId) continue;
			if (extractAgentType(data) !== agentType) continue;
			return 'awaiting-slot';
		}
	} catch (err) {
		logger.warn('[lock-state-classifier] queue lookup failed; defaulting to awaiting-slot', {
			error: String(err),
			projectId,
			workItemId,
			agentType,
		});
		return 'awaiting-slot';
	}

	return 'wedged';
}
