import { type ConnectionOptions, Queue } from 'bullmq';
import { routerConfig } from './config.js';

// Parse Redis URL to connection options
function parseRedisUrl(url: string): ConnectionOptions {
	const parsed = new URL(url);
	return {
		host: parsed.hostname,
		port: Number(parsed.port) || 6379,
		password: parsed.password || undefined,
	};
}

const connection = parseRedisUrl(routerConfig.redisUrl);

// Job types
export interface TrelloJob {
	type: 'trello';
	source: 'trello';
	payload: unknown;
	projectId: string;
	cardId: string;
	actionType: string;
	receivedAt: string;
}

export interface GitHubJob {
	type: 'github';
	source: 'github';
	payload: unknown;
	eventType: string;
	repoFullName: string;
	receivedAt: string;
}

export interface JiraJob {
	type: 'jira';
	source: 'jira';
	payload: unknown;
	projectId: string;
	issueKey: string;
	webhookEvent: string;
	receivedAt: string;
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
	console.error('[Queue] Error:', err);
});

console.log('[Queue] Initialized with Redis at', routerConfig.redisUrl);

// Helper to add a job
export async function addJob(job: CascadeJob): Promise<string> {
	const jobId = `${job.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const result = await jobQueue.add(job.type, job, { jobId });
	console.log('[Queue] Job added:', { id: result.id, type: job.type });
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
