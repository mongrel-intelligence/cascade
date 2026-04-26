/**
 * Compensating action for dispatch failures.
 *
 * Released by BullMQ's `worker.on('failed')` handler so that any in-memory
 * lock state acquired during the webhook → enqueue path (work-item lock,
 * agent-type lock, recently-dispatched dedup mark) is freed the moment a
 * dispatch attempt is declared dead. Without this, the lock entries leak
 * for up to their TTL (work-item: 30 min) and silently reject every
 * follow-up webhook for the same `(projectId, workItemId, agentType)`.
 *
 * The compensator NEVER propagates errors. A failure here would poison the
 * BullMQ worker; instead we capture to Sentry and log, then resolve.
 */

import { captureException } from '../sentry.js';
import { logger } from '../utils/logging.js';
import { clearAgentTypeEnqueued, clearRecentlyDispatched } from './agent-type-lock.js';
import type { CascadeJob } from './queue.js';
import { clearWorkItemEnqueued } from './work-item-lock.js';
import { extractAgentType, extractProjectIdFromJob, extractWorkItemId } from './worker-env.js';

// Compensator accepts `unknown` because it runs from BullMQ's `failed` event
// where the job payload type is the queue's generic and not directly
// assignable to CascadeJob (manual-run / debug-analysis jobs come through
// `cascade-dashboard-jobs`). The extractors handle type-narrowing.
export async function releaseLocksForFailedJob(data: unknown): Promise<void> {
	try {
		const projectId = await extractProjectIdFromJob(data as CascadeJob);
		if (!projectId) return;

		const workItemId = extractWorkItemId(data as CascadeJob);
		const agentType = extractAgentType(data as CascadeJob);

		if (workItemId && agentType) {
			clearWorkItemEnqueued(projectId, workItemId, agentType);
		}
		if (agentType) {
			clearAgentTypeEnqueued(projectId, agentType);
			clearRecentlyDispatched(projectId, agentType, workItemId);
		}
	} catch (err) {
		logger.error('[dispatch-compensator] failed to release locks for failed job', {
			error: String(err),
		});
		captureException(err instanceof Error ? err : new Error(String(err)), {
			tags: { source: 'dispatch_compensator' },
		});
	}
}
