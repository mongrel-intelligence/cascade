import { Queue } from 'bullmq';
import { captureException } from '../sentry.js';
import type { TriggerResult } from '../types/index.js';
import { logger } from '../utils/logging.js';
import { parseRedisUrl } from '../utils/redis.js';
import { routerConfig } from './config.js';

const connection = parseRedisUrl(routerConfig.redisUrl);

// Job types
// Note: ackCommentId is `string` for Trello/JIRA (string IDs from their APIs)
// and `number` for GitHub (numeric IDs from GitHub API). Downstream consumers
// (ProgressMonitor) normalize to string via the adapter layer.
export interface TrelloJob {
	type: 'trello';
	source: 'trello';
	payload: unknown;
	projectId: string;
	workItemId: string;
	actionType: string;
	receivedAt: string;
	ackCommentId?: string;
	triggerResult?: TriggerResult;
	/** When true, the worker must post the ack comment before processing (deferred ack). */
	pendingAck?: boolean;
	/**
	 * Work-item title stored as a context hint, passed to `generateAckMessage`
	 * at deferred-ack fire time. NOT the literal comment text — the worker
	 * generates the actual ack message via the role-aware LLM path. Renamed
	 * from `ackMessage` (which read like the literal text) for clarity.
	 */
	ackContextHint?: string;
}

export interface GitHubJob {
	type: 'github';
	source: 'github';
	payload: unknown;
	eventType: string;
	repoFullName: string;
	receivedAt: string;
	ackCommentId?: number;
	ackMessage?: string;
	triggerResult?: TriggerResult;
}

export interface JiraJob {
	type: 'jira';
	source: 'jira';
	payload: unknown;
	projectId: string;
	issueKey: string;
	webhookEvent: string;
	receivedAt: string;
	ackCommentId?: string;
	triggerResult?: TriggerResult;
	/** When true, the worker must post the ack comment before processing (deferred ack). */
	pendingAck?: boolean;
	/**
	 * Work-item title stored as a context hint, passed to `generateAckMessage`
	 * at deferred-ack fire time. NOT the literal comment text — the worker
	 * generates the actual ack message via the role-aware LLM path. Renamed
	 * from `ackMessage` (which read like the literal text) for clarity.
	 */
	ackContextHint?: string;
}

export interface SentryJob {
	type: 'sentry';
	source: 'sentry';
	payload: unknown;
	projectId: string;
	/** Sentry resource type: 'event_alert' | 'metric_alert' | 'issue' */
	eventType: string;
	receivedAt: string;
	triggerResult?: TriggerResult;
}

export interface LinearJob {
	type: 'linear';
	source: 'linear';
	payload: unknown;
	projectId: string;
	workItemId?: string;
	eventType: string;
	receivedAt: string;
	ackCommentId?: string;
	triggerResult?: TriggerResult;
	/** When true, the worker must post the ack comment before processing (deferred ack). */
	pendingAck?: boolean;
	/**
	 * Work-item title stored as a context hint, passed to `generateAckMessage`
	 * at deferred-ack fire time. NOT the literal comment text — the worker
	 * generates the actual ack message via the role-aware LLM path. Renamed
	 * from `ackMessage` (which read like the literal text) for clarity.
	 */
	ackContextHint?: string;
}

export type CascadeJob = TrelloJob | GitHubJob | JiraJob | SentryJob | LinearJob;

// Create the job queue
export const jobQueue = new Queue<CascadeJob>('cascade-jobs', {
	connection,
	defaultJobOptions: {
		// Spec 015/2: bounded retries on dispatch failures only. Terminal
		// errors (validation, image-not-found-after-fallback) bypass via
		// `UnrecoverableError`. Agents themselves still handle their own
		// internal errors — these attempts apply only to the dispatch path
		// (the time between BullMQ pulling the job and the worker
		// container *starting*, before the agent is even running).
		attempts: 4,
		backoff: { type: 'exponential', delay: 5_000 },
		removeOnComplete: {
			age: 24 * 60 * 60, // Keep completed jobs for 24 hours
			count: 100, // Keep last 100 completed jobs
		},
		removeOnFail: {
			age: 7 * 24 * 60 * 60, // Keep failed jobs for 7 days
		},
	},
});

// Queue event logging
jobQueue.on('error', (err) => {
	logger.error('Queue error', { error: String(err) });
	captureException(err, { tags: { source: 'job_queue' } });
});

logger.info('Queue initialized', { redisUrl: routerConfig.redisUrl });

// Helper to add a job
export async function addJob(job: CascadeJob): Promise<string> {
	const jobId = `${job.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const result = await jobQueue.add(job.type, job, { jobId });
	logger.info('Job added to queue', { id: result.id, type: job.type });
	return result.id ?? jobId;
}

export interface ScheduleCoalescedJobResult {
	/** The unique BullMQ job id for the newly-scheduled delayed job. */
	jobId: string;
	/** True when a prior pending (delayed/waiting) job for the same coalesceKey was removed. */
	superseded: boolean;
	/**
	 * Data from the first superseded pending job (when `superseded === true`).
	 * Used by the caller to release the orphaned in-memory locks that were
	 * marked for the previous dispatch — those locks are never released via
	 * `worker.on('failed')` because BullMQ's `remove()` does not fire that event.
	 */
	supersededJobData?: CascadeJob;
}

/**
 * Schedule a PM job as a BullMQ delayed job, coalescing within `delayMs` of
 * other events with the same `coalesceKey`.
 *
 * **Identifier strategy.** Each call produces a UNIQUE jobId
 * (`coalesce:${coalesceKey}:${timestamp}-${rand}`) and stores `coalesceKey`
 * as the BullMQ "job name" — that name is what we filter by when locating
 * prior pending jobs to supersede. Reusing a deterministic
 * `coalesce:${coalesceKey}` jobId (the prior design) was a live bug:
 * BullMQ's `add(name, data, { jobId })` is a silent no-op when a job with
 * that id already exists in the completed/failed/active set, and BullMQ
 * keeps completed jobs for 24h via `removeOnComplete: { age: 86400 }` —
 * so any new event for a coalesceKey whose previous job had already
 * completed within 24h was silently dropped. (Live incident 2026-04-29:
 * splitting agent for `MNG-422` was lost because the same-id planning job
 * was still running when the splitting webhook arrived.)
 *
 * **Supersede semantics.** Only `'delayed'` and `'waiting'` jobs supersede:
 * those are the dedup targets — multiple webhooks within the 10s window
 * for the same `(projectId, workItemId)`. Active jobs are NOT considered
 * (they're busy doing the previous unit of work; the new event becomes its
 * own delayed dispatch behind it). Completed/failed jobs are NOT considered
 * (they're done — the new event is real new intent and must run).
 *
 * **Concurrency.** The getDelayed → getWaiting → filter → remove → add
 * sequence is not atomic. Two concurrent schedules for the same coalesceKey
 * may both observe the same prior pending job, both attempt to remove it
 * (one wins, the other no-ops), then both add() new jobs with distinct
 * unique jobIds. The result is up to two delayed jobs firing — equivalent
 * to two unrelated webhooks landing back-to-back, which the downstream
 * pipeline already handles via the in-flight work-item lock. The prior
 * deterministic-id design had a worse failure mode (silent drop); this
 * accepts a rare extra-firing in exchange for never losing events.
 */
export async function scheduleCoalescedJob(
	job: CascadeJob,
	coalesceKey: string,
	delayMs: number,
): Promise<ScheduleCoalescedJobResult> {
	// Build a colon-free unique jobId. BullMQ rejects custom ids that contain
	// `:` unless the id has exactly 3 colon-separated parts (legacy repeatable-
	// job compatibility); the prior deterministic `coalesce:${coalesceKey}`
	// happened to have 3 parts (`coalesce`, projectId, workItemId) so it
	// passed, but a 4th `:${timestamp}` segment would not. Using `_` as the
	// internal separator also keeps the id compatible with Docker container
	// names (which reject colons — verified by the spec-017 follow-up
	// hotfix at src/router/container-manager.ts:485).
	const safeKey = coalesceKey.replace(/:/g, '_');
	const newJobId = `coalesce_${safeKey}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

	// Find any pending (delayed/waiting) jobs for the same coalesceKey by
	// matching the BullMQ "job name". Note: getDelayed/getWaiting do NOT
	// include active/completed/failed jobs — the supersede behavior is by
	// design scoped to "events that haven't fired yet".
	const [delayed, waiting] = await Promise.all([jobQueue.getDelayed(), jobQueue.getWaiting()]);
	const pending = [...delayed, ...waiting].filter((j) => j.name === coalesceKey);

	let superseded = false;
	let supersededJobData: CascadeJob | undefined;
	if (pending.length > 0) {
		// Capture the first job's data for lock cleanup. Multiple concurrent
		// schedules for the same key are uncommon (the window is 10s), but
		// remove() ALL matching pending jobs to keep the queue tidy.
		supersededJobData = pending[0].data as CascadeJob;
		await Promise.all(pending.map((j) => j.remove()));
		superseded = true;
	}

	await jobQueue.add(coalesceKey, job, { jobId: newJobId, delay: delayMs });
	logger.info('Coalesced job scheduled', {
		jobId: newJobId,
		coalesceKey,
		delayMs,
		superseded,
		supersededCount: pending.length,
	});

	return { jobId: newJobId, superseded, supersededJobData };
}

// Get queue stats
export async function getQueueStats() {
	const [waiting, active, completed, failed] = await Promise.all([
		jobQueue.getWaitingCount(),
		jobQueue.getActiveCount(),
		jobQueue.getCompletedCount(),
		jobQueue.getFailedCount(),
	]);
	return { waiting, active, completed, failed };
}
