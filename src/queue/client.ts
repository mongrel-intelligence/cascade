/**
 * Lightweight BullMQ client for the dashboard container.
 *
 * Submits jobs to a dedicated queue that the router's worker-manager picks up.
 * Only loaded when REDIS_URL is set (production dashboard container).
 */

import { type ConnectionOptions, Queue } from 'bullmq';

// ── Job types ────────────────────────────────────────────────────────────────

export interface ManualRunJob {
	type: 'manual-run';
	projectId: string;
	agentType: string;
	cardId?: string;
	prNumber?: number;
	prBranch?: string;
	repoFullName?: string;
	headSha?: string;
	modelOverride?: string;
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
	cardId?: string;
}

export type DashboardJob = ManualRunJob | RetryRunJob | DebugAnalysisJob;

// ── Queue ────────────────────────────────────────────────────────────────────

const QUEUE_NAME = 'cascade-dashboard-jobs';

function parseRedisUrl(url: string): ConnectionOptions {
	const parsed = new URL(url);
	return {
		host: parsed.hostname,
		port: Number(parsed.port) || 6379,
		password: parsed.password || undefined,
	};
}

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
				attempts: 1,
				removeOnComplete: { age: 24 * 60 * 60, count: 100 },
				removeOnFail: { age: 7 * 24 * 60 * 60 },
			},
		});
	}
	return queue;
}

export async function submitDashboardJob(job: DashboardJob): Promise<string> {
	const jobId = `${job.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const result = await getQueue().add(job.type, job, { jobId });
	return result.id ?? jobId;
}
