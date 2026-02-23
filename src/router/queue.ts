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
	cardId: string;
	actionType: string;
	receivedAt: string;
	ackCommentId?: string;
	triggerResult?: TriggerResult;
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
}

export type CascadeJob = TrelloJob | GitHubJob | JiraJob;

// Create the job queue
export const jobQueue = new Queue<CascadeJob>('cascade-jobs', {
	connection,
	defaultJobOptions: {
		attempts: 1, // No retries - agents handle their own errors
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
