/**
 * Lightweight BullMQ client for the dashboard container.
 *
 * Submits jobs to a dedicated queue that the router's worker-manager picks up.
 * Only loaded when REDIS_URL is set (production dashboard container).
 */

import { type JobState, Queue } from 'bullmq';
import { parseRedisUrl } from '../utils/redis.js';

// ── Job types ────────────────────────────────────────────────────────────────

export interface ManualRunJob {
	type: 'manual-run';
	projectId: string;
	agentType: string;
	workItemId?: string;
	workItemUrl?: string;
	workItemTitle?: string;
	prNumber?: number;
	prBranch?: string;
	repoFullName?: string;
	headSha?: string;
	modelOverride?: string;
	triggerCommentBody?: string;
	triggerCommentId?: number;
	triggerCommentUrl?: string;
	triggerCommentPath?: string;
	triggerCommentAuthor?: string;
}

export interface RetryRunJob {
	type: 'retry-run';
	runId: string;
	projectId: string;
	modelOverride?: string;
}

export interface DebugAnalysisJob {
	type: 'debug-analysis';
	runId: string;
	projectId: string;
	workItemId?: string;
}

export type DashboardJob = ManualRunJob | RetryRunJob | DebugAnalysisJob;

// ── Queue ────────────────────────────────────────────────────────────────────

const QUEUE_NAME = 'cascade-dashboard-jobs';

let queue: Queue<DashboardJob> | null = null;

function getQueue(): Queue<DashboardJob> {
	if (!queue) {
		const redisUrl = process.env.REDIS_URL;
		if (!redisUrl) {
			throw new Error('REDIS_URL is required for queue dispatch');
		}
		queue = new Queue<DashboardJob>(QUEUE_NAME, {
			connection: parseRedisUrl(redisUrl),
			defaultJobOptions: {
				// Spec 015/2: bounded retries on dispatch failures, parity with
				// the cascade-jobs queue. Manual-run / retry-run / debug-analysis
				// jobs hit the same dispatch path — should benefit from the same
				// transient-failure absorption.
				attempts: 4,
				backoff: { type: 'exponential', delay: 5_000 },
				removeOnComplete: { age: 24 * 60 * 60, count: 100 },
				removeOnFail: { age: 7 * 24 * 60 * 60 },
			},
		});
	}
	return queue;
}

export async function submitDashboardJob(job: DashboardJob, jobId?: string): Promise<string> {
	const id = jobId ?? `${job.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const result = await getQueue().add(job.type, job, { jobId: id });
	return result.id ?? id;
}

// ── Debug-analysis job-state helpers ───────────────────────────────────────────
//
// These let the dashboard process (where the API runs) observe running/queued/
// failed state for a debug-analysis job cross-process, using the BullMQ queue as
// the source of truth rather than the worker-local in-memory Set in
// `src/triggers/shared/debug-status.ts`. Pairing a deterministic job id (one job
// per analyzed run) with state read + idempotent removal lets a re-run reuse the
// same id without a stale completed/failed job blocking the add.

/**
 * Deterministic BullMQ job id for the debug-analysis job of a given run.
 *
 * One job per analyzed run: passing this id to {@link submitDashboardJob} makes
 * the queue self-deduplicating for `debug-analysis` and lets other processes
 * resolve the job's state by run id alone.
 */
export function debugAnalysisJobId(runId: string): string {
	return `debug-analysis-${runId}`;
}

/**
 * Resolve the BullMQ state of a dashboard job by id.
 *
 * Returns the job's state (`waiting | active | delayed | prioritized |
 * waiting-children | completed | failed | unknown`) or `null` when no job with
 * that id exists in the queue.
 */
export async function getDashboardJobState(jobId: string): Promise<JobState | 'unknown' | null> {
	const job = await getQueue().getJob(jobId);
	if (!job) {
		return null;
	}
	return job.getState();
}

/**
 * Remove a dashboard job by id.
 *
 * Wrapped in try/catch so it is a safe no-op when the job is absent or locked
 * (e.g. currently active in a worker). This lets a re-run reuse the same
 * deterministic id (see {@link debugAnalysisJobId}) without a stale
 * completed/failed job blocking a subsequent {@link submitDashboardJob}.
 */
export async function removeDashboardJob(jobId: string): Promise<void> {
	try {
		await getQueue().remove(jobId);
	} catch {
		// Safe no-op: the job may be absent or locked (active). Removal failures
		// must not surface to the caller — the next add will reuse the id.
	}
}
