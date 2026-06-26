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

import { resolveEngineName } from '../backends/resolution.js';
import {
	completeRun,
	createRun,
	failQueuedOrRunningRun,
} from '../db/repositories/runsRepository.js';
import { captureException } from '../sentry.js';
import type { TriggerResult } from '../types/index.js';
import { logger } from '../utils/logging.js';
import { clearAgentTypeEnqueued, clearRecentlyDispatched } from './agent-type-lock.js';
import { loadProjectConfig } from './config.js';
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

/**
 * Insert a `failed` stub run row so a dispatch that never produced a worker
 * still surfaces in the dashboard and `cascade runs list`. Called from
 * BullMQ's `worker.on('failed')` handler, so it fires exactly once per
 * permanently-failed job — either after the retry budget is exhausted
 * (transient) or immediately when `UnrecoverableError` is wrapped (terminal).
 * Intermediate retries do NOT trigger it, so a transient Docker socket error
 * that BullMQ later recovers from leaves no stub behind to mislead operators.
 *
 * Without this row, the worker (which calls `tryCreateRun` at boot) never
 * runs, `failOrphanedRun` no-ops because there is no `status='running'` row,
 * and the failure is invisible outside Sentry — the 2026-06-15 Damisa
 * outage class.
 *
 * Best-effort: any DB failure here is logged at WARN and swallowed.
 */
export async function recordSpawnFailureStub(data: unknown, err: unknown): Promise<void> {
	try {
		// MNG-1695 fast-path: a manual-run job carries the id of a `queued` run row
		// pre-created at tRPC trigger time. Fail THAT row instead of inserting a
		// duplicate stub. Scoped to `manual-run` so we never flip a `retry-run` /
		// `debug-analysis` job's `runId` (which references the original/analyzed
		// run) to `failed`.
		const job = data as { type?: string; runId?: string };
		if (job.type === 'manual-run' && job.runId) {
			await failQueuedOrRunningRun(job.runId, `Worker spawn failed: ${String(err)}`);
			return;
		}

		const projectId = await extractProjectIdFromJob(data as CascadeJob);
		if (!projectId) return;
		const agentType = extractAgentType(data as CascadeJob);
		if (!agentType) return;
		const workItemId = extractWorkItemId(data as CascadeJob);
		const triggerResult = (data as { triggerResult?: TriggerResult }).triggerResult;
		const prNumber = triggerResult?.prNumber;
		const triggerType = triggerResult?.agentInput?.triggerType;
		let engine = 'unknown';
		try {
			const { fullProjects } = await loadProjectConfig();
			const projectCfg = fullProjects.find((p) => p.id === projectId);
			if (projectCfg) engine = resolveEngineName(agentType, projectCfg);
		} catch {
			// engine column is NOT NULL — fall through with 'unknown' rather
			// than letting a config-read problem block the visibility stub.
		}
		const runId = await createRun({
			projectId,
			workItemId,
			prNumber,
			agentType,
			engine,
			triggerType,
		});
		await completeRun(runId, {
			status: 'failed',
			durationMs: 0,
			error: `Worker spawn failed: ${String(err)}`,
		});
	} catch (dbErr) {
		logger.warn('[dispatch-compensator] failed to record spawn-failure stub run', {
			error: String(dbErr),
		});
	}
}
