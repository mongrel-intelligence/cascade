import { logger } from '../utils/logging.js';
import {
	GitHubPlatformClient,
	JiraPlatformClient,
	TrelloPlatformClient,
} from './platformClients.js';
import type { CascadeJob, GitHubJob, JiraJob, TrelloJob } from './queue.js';

/**
 * Format a duration in milliseconds to a human-readable string.
 * e.g. 1800000 → "30m 0s", 90000 → "1m 30s", 3661000 → "1h 1m 1s"
 */
export function formatDuration(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	if (hours > 0) {
		return `${hours}h ${minutes}m ${seconds}s`;
	}
	return `${minutes}m ${seconds}s`;
}

/**
 * Extract PR number from a GitHub webhook payload based on event type.
 * Returns null if the PR number cannot be determined.
 */
export function extractPRNumber(job: GitHubJob): number | null {
	const payload = job.payload as Record<string, unknown>;

	switch (job.eventType) {
		case 'pull_request':
		case 'pull_request_review':
		case 'pull_request_review_comment': {
			const pr = payload.pull_request as Record<string, unknown> | undefined;
			return (pr?.number as number) ?? null;
		}
		case 'issue_comment': {
			const issue = payload.issue as Record<string, unknown> | undefined;
			return (issue?.number as number) ?? null;
		}
		case 'check_suite': {
			const suite = payload.check_suite as Record<string, unknown> | undefined;
			const prs = suite?.pull_requests as Array<Record<string, unknown>> | undefined;
			return (prs?.[0]?.number as number) ?? null;
		}
		default:
			return null;
	}
}

function buildTimeoutMessage(
	jobId: string,
	startedAt: Date,
	durationMs: number,
	retryGuidance: string,
): string {
	const duration = formatDuration(durationMs);
	return [
		'⚠️ **Agent Timeout**',
		'',
		`The CASCADE worker timed out after ${duration} and was terminated.`,
		'',
		`- **Job ID**: ${jobId}`,
		`- **Started**: ${startedAt.toISOString()}`,
		'',
		retryGuidance,
	].join('\n');
}

interface TimeoutInfo {
	jobId: string;
	startedAt: Date;
	durationMs: number;
}

async function notifyTrelloTimeout(job: TrelloJob, info: TimeoutInfo): Promise<void> {
	const message = buildTimeoutMessage(
		info.jobId,
		info.startedAt,
		info.durationMs,
		'Move this card back to the trigger list to retry.',
	);

	const client = new TrelloPlatformClient(job.projectId);
	const result = await client.postComment(job.cardId, message);
	if (result !== null) {
		logger.info('[Notifications] Trello timeout comment posted for card:', job.cardId);
	}
}

async function notifyGitHubTimeout(job: GitHubJob, info: TimeoutInfo): Promise<void> {
	const prNumber = extractPRNumber(job);
	if (!prNumber) {
		logger.warn(
			'[Notifications] Could not extract PR number from GitHub job, skipping notification',
		);
		return;
	}

	const client = await GitHubPlatformClient.fromRepo(job.repoFullName);
	if (!client) {
		return;
	}

	const message = buildTimeoutMessage(
		info.jobId,
		info.startedAt,
		info.durationMs,
		'Re-trigger by pushing a new commit or re-requesting the check suite.',
	);

	const result = await client.postComment(prNumber, message);
	if (result !== null) {
		logger.info('[Notifications] GitHub timeout comment posted for PR:', prNumber);
	}
}

async function notifyJiraTimeout(job: JiraJob, info: TimeoutInfo): Promise<void> {
	const message = buildTimeoutMessage(
		info.jobId,
		info.startedAt,
		info.durationMs,
		'Transition the issue back to the trigger status to retry.',
	);

	const client = new JiraPlatformClient(job.projectId);
	const result = await client.postComment(job.issueKey, message);
	if (result !== null) {
		logger.info('[Notifications] JIRA timeout comment posted for issue:', job.issueKey);
	}
}

/**
 * Send a timeout notification for a job. Dispatches to Trello, GitHub, or JIRA
 * based on job type. Errors are caught and logged — never propagated.
 */
export async function notifyTimeout(job: CascadeJob, info: TimeoutInfo): Promise<void> {
	try {
		if (job.type === 'trello') {
			await notifyTrelloTimeout(job, info);
		} else if (job.type === 'github') {
			await notifyGitHubTimeout(job, info);
		} else if (job.type === 'jira') {
			await notifyJiraTimeout(job, info);
		} else {
			logger.warn('[Notifications] Unknown job type, skipping notification');
		}
	} catch (err) {
		logger.error('[Notifications] Failed to send timeout notification:', String(err));
	}
}
