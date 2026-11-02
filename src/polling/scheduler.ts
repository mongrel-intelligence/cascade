/**
 * Polling scheduler.
 *
 * Uses BullMQ Job Scheduler to run polling cycles at regular intervals.
 * Worker concurrency is 1 to ensure sequential processing.
 */

import { Octokit } from '@octokit/rest';
import { type ConnectionOptions, Queue, Worker } from 'bullmq';
import { getProjectGitHubToken } from '../config/projects.js';
import { loadProjectConfig } from '../router/config.js';
import { resolveJiraCredentials } from '../router/platformClients/index.js';
import { captureException } from '../sentry.js';
import { registerBuiltInTriggers } from '../triggers/builtins.js';
import { createTriggerRegistry, type TriggerRegistry } from '../triggers/registry.js';
import type { ProjectConfig } from '../types/index.js';
import { logger } from '../utils/logging.js';
import { parseRedisUrl } from '../utils/redis.js';
import { getPollingAdapter } from './adapter.js';
import * as cleanup from './cleanup.js';
import { handleGitHubRepoColdStart, handleJiraColdStart } from './cold-start.js';
import { pollingConfig } from './config.js';
import { pollCheckSuitesForRepo } from './providers/github/check-suite-poller.js';
import { pollMergedPRsForRepo } from './providers/github/merged-pr-poller.js';
import { pollPRConflictsForRepo } from './providers/github/pr-conflict-poller.js';
import { pollPRReviewsForRepo } from './providers/github/pr-review-poller.js';
import {
	type JiraApiClient,
	type JiraSearchResponse,
	pollJiraStatusChanges,
} from './providers/jira/index.js';

const QUEUE_NAME = 'polling-scheduler';
const JOB_NAME = 'poll-cycle';

let queue: Queue | null = null;
let worker: Worker | null = null;
let connection: ConnectionOptions | null = null;
let lastCleanupTime: number | null = null;

/** One day in milliseconds for cleanup interval */
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Reset cleanup state for testing */
export function resetCleanupState(): void {
	lastCleanupTime = null;
}

/**
 * Initialize the polling scheduler.
 */
export async function startPollingScheduler(): Promise<void> {
	if (!pollingConfig.enabled) {
		logger.info('Polling is disabled, scheduler not started');
		return;
	}

	const redisUrl = process.env.REDIS_URL;
	if (!redisUrl) {
		logger.error('REDIS_URL not set, cannot start polling scheduler');
		return;
	}

	logger.info('Starting polling scheduler', {
		intervalMs: pollingConfig.intervalMs,
	});

	// Create Redis connection options using shared utility
	connection = parseRedisUrl(redisUrl);

	// Create queue
	queue = new Queue(QUEUE_NAME, {
		connection,
	});

	// Create trigger registry for dispatch
	const triggerRegistry = createTriggerRegistry();
	registerBuiltInTriggers(triggerRegistry);

	// Create worker with concurrency 1
	worker = new Worker(
		QUEUE_NAME,
		async () => {
			await runPollCycle(triggerRegistry);
		},
		{
			connection,
			concurrency: 1,
		},
	);

	worker.on('failed', (job, err) => {
		logger.error('Poll cycle job failed', {
			jobId: job?.id,
			error: String(err),
		});
		captureException(err, {
			tags: { source: 'polling_scheduler' },
			extra: { jobId: job?.id },
		});
	});

	worker.on('error', (err) => {
		logger.error('Polling worker error', { error: String(err) });
		captureException(err, { tags: { source: 'polling_worker' } });
	});

	// Schedule repeating job
	await queue.upsertJobScheduler(
		'poll-scheduler',
		{
			every: pollingConfig.intervalMs,
		},
		{
			name: JOB_NAME,
			data: {},
			opts: {
				removeOnComplete: 100,
				removeOnFail: 100,
			},
		},
	);

	logger.info('Polling scheduler started');
}

/**
 * Stop the polling scheduler.
 */
export async function stopPollingScheduler(): Promise<void> {
	if (worker) {
		await worker.close();
		worker = null;
	}

	if (queue) {
		await queue.close();
		queue = null;
	}

	connection = null;
	lastCleanupTime = null;

	logger.info('Polling scheduler stopped');
}

/**
 * Run a single poll cycle for all projects.
 */
async function runPollCycle(triggerRegistry: TriggerRegistry): Promise<void> {
	const startTime = Date.now();
	logger.debug('Starting poll cycle');

	const { fullProjects } = await loadProjectConfig();
	if (fullProjects.length === 0) {
		logger.debug('No projects configured, skipping poll cycle');
		return;
	}

	const githubAdapter = getPollingAdapter('github');
	const jiraAdapter = getPollingAdapter('jira');
	let totalEmitted = 0;
	let totalErrors = 0;

	for (const project of fullProjects) {
		// Poll GitHub
		try {
			const stats = await pollGitHubProject(project, githubAdapter, triggerRegistry);
			totalEmitted += stats.emitted;
			totalErrors += stats.errors;
		} catch (error) {
			totalErrors++;
			logger.error('Failed to poll GitHub for project', {
				projectId: project.id,
				error: String(error),
			});
			captureException(error instanceof Error ? error : new Error(String(error)), {
				tags: { source: 'polling_cycle_github', projectId: project.id },
			});
		}

		// Poll Jira (if project has Jira integration)
		if (project.jira?.projectKey) {
			try {
				const stats = await pollJiraProject(project, jiraAdapter, triggerRegistry);
				totalEmitted += stats.emitted;
				totalErrors += stats.errors;
			} catch (error) {
				totalErrors++;
				logger.error('Failed to poll Jira for project', {
					projectId: project.id,
					error: String(error),
				});
				captureException(error instanceof Error ? error : new Error(String(error)), {
					tags: { source: 'polling_cycle_jira', projectId: project.id },
				});
			}
		}
	}

	const durationMs = Date.now() - startTime;
	logger.info('Poll cycle complete', {
		projectCount: fullProjects.length,
		totalEmitted,
		totalErrors,
		durationMs,
	});

	// Run ledger cleanup once per day
	await maybeRunLedgerCleanup();
}

/**
 * Run ledger cleanup if 24 hours have passed since last cleanup.
 * Uses in-memory tracking (single instance assumption per CLAUDE.md).
 * Exported for testing.
 */
export async function maybeRunLedgerCleanup(): Promise<void> {
	const now = Date.now();

	// Skip if we've run cleanup within the last 24 hours
	if (lastCleanupTime !== null && now - lastCleanupTime < CLEANUP_INTERVAL_MS) {
		return;
	}

	try {
		const rowsDeleted = await cleanup.cleanupPollingLedger();
		lastCleanupTime = now;
		logger.info('Ledger cleanup completed', { rowsDeleted });
	} catch (error) {
		// Log but don't fail the poll cycle for cleanup errors
		logger.error('Ledger cleanup failed', { error: String(error) });
		captureException(error instanceof Error ? error : new Error(String(error)), {
			tags: { source: 'polling_ledger_cleanup' },
		});
	}
}

/**
 * Poll GitHub for a single project.
 */
async function pollGitHubProject(
	project: ProjectConfig,
	adapter: ReturnType<typeof getPollingAdapter>,
	triggerRegistry: TriggerRegistry,
): Promise<{ emitted: number; errors: number }> {
	const stats = { emitted: 0, errors: 0 };

	// Get GitHub token
	let githubToken: string;
	try {
		githubToken = await getProjectGitHubToken(project);
	} catch {
		logger.warn('No GitHub token for project, skipping', { projectId: project.id });
		return stats;
	}

	const octokit = new Octokit({ auth: githubToken });

	// Get repo from project config
	const repo = project.repo;
	if (!repo) {
		logger.warn('No repo configured for project, skipping', { projectId: project.id });
		return stats;
	}

	const [owner, repoName] = repo.split('/');
	if (!owner || !repoName) {
		logger.warn('Invalid repo format', { projectId: project.id, repo });
		return stats;
	}

	// Handle cold start
	await handleGitHubRepoColdStart(project.id, owner, repoName, octokit);

	// Poll check suites
	const checkSuiteResult = await pollCheckSuitesForRepo(
		project.id,
		owner,
		repoName,
		octokit,
		adapter,
		triggerRegistry,
	);
	stats.emitted += checkSuiteResult.emitted;
	stats.errors += checkSuiteResult.errors;

	// Poll PR reviews
	const prReviewResult = await pollPRReviewsForRepo(
		project.id,
		owner,
		repoName,
		octokit,
		adapter,
		triggerRegistry,
	);
	stats.emitted += prReviewResult.emitted;
	stats.errors += prReviewResult.errors;

	// Poll PR conflicts (uses openPRs from review poller)
	// Skip if review poller failed (no list) — openPRs is empty and errors > 0
	if (prReviewResult.openPRs.length > 0 || prReviewResult.errors === 0) {
		try {
			const conflictResult = await pollPRConflictsForRepo(
				project.id,
				owner,
				repoName,
				octokit,
				adapter,
				triggerRegistry,
				prReviewResult.openPRs,
			);
			stats.emitted += conflictResult.emitted;
			stats.errors += conflictResult.errors;
		} catch (error) {
			stats.errors++;
			logger.error('Failed to poll PR conflicts', {
				projectId: project.id,
				repo: `${owner}/${repoName}`,
				error: String(error),
			});
			captureException(error instanceof Error ? error : new Error(String(error)), {
				tags: { source: 'polling_pr_conflicts', projectId: project.id },
			});
		}
	}

	// Poll merged PRs
	const mergedPRResult = await pollMergedPRsForRepo(
		project.id,
		owner,
		repoName,
		octokit,
		adapter,
		triggerRegistry,
	);
	stats.emitted += mergedPRResult.emitted;
	stats.errors += mergedPRResult.errors;

	return stats;
}

/**
 * Create a Jira API client for a project.
 */
function createJiraApiClient(baseUrl: string, auth: string): JiraApiClient {
	return {
		async searchIssues(params: {
			jql: string;
			fields: string[];
			expand: string[];
			nextPageToken?: string;
		}): Promise<JiraSearchResponse> {
			const url = new URL(`${baseUrl}/rest/api/3/search/jql`);
			url.searchParams.set('jql', params.jql);
			url.searchParams.set('fields', params.fields.join(','));
			url.searchParams.set('expand', params.expand.join(','));
			if (params.nextPageToken) {
				url.searchParams.set('nextPageToken', params.nextPageToken);
			}

			const response = await fetch(url.toString(), {
				headers: {
					Authorization: `Basic ${auth}`,
					Accept: 'application/json',
				},
			});

			if (!response.ok) {
				const text = await response.text();
				throw new Error(`Jira API error ${response.status}: ${text}`);
			}

			return response.json() as Promise<JiraSearchResponse>;
		},
	};
}

/**
 * Poll Jira for a single project.
 */
async function pollJiraProject(
	project: ProjectConfig,
	adapter: ReturnType<typeof getPollingAdapter>,
	triggerRegistry: TriggerRegistry,
): Promise<{ emitted: number; errors: number }> {
	const stats = { emitted: 0, errors: 0 };

	const jiraProjectKey = project.jira?.projectKey;
	if (!jiraProjectKey) {
		return stats;
	}

	// Get Jira credentials
	const jiraCreds = await resolveJiraCredentials(project.id);
	if (!jiraCreds) {
		logger.warn('No Jira credentials for project, skipping', { projectId: project.id });
		return stats;
	}

	// Create Jira API client
	const jiraClient = createJiraApiClient(jiraCreds.baseUrl, jiraCreds.auth);

	// Handle cold start (seeds ledger without dispatch on first poll)
	await handleJiraColdStart(project.id, jiraProjectKey, jiraClient);

	// Poll status changes
	// NOTE: No author/bot filtering — Cascade uses the user's own Jira account,
	// so filtering by author would drop every manual status move.
	const statusResult = await pollJiraStatusChanges(
		project.id,
		jiraProjectKey,
		jiraClient,
		adapter,
		triggerRegistry,
	);
	stats.emitted += statusResult.emitted;
	stats.errors += statusResult.errors;

	return stats;
}
