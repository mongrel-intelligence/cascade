/**
 * Worker Entry Point
 *
 * This is the entry point for Cascade worker containers. It:
 * 1. Reads job data from environment variables
 * 2. Processes the job (Trello, GitHub, or JIRA webhook)
 * 3. Exits when complete
 *
 * Environment variables:
 * - JOB_ID: Unique job identifier
 * - JOB_TYPE: 'trello', 'github', or 'jira'
 * - JOB_DATA: JSON-encoded job payload
 * - DATABASE_URL: PostgreSQL connection string for config
 */

import { loadEnvConfigSafe } from './config/env.js';
import { loadConfig } from './config/provider.js';
import { getDb } from './db/client.js';
import { captureException, flush, setTag } from './sentry.js';
import {
	type TriggerRegistry,
	createTriggerRegistry,
	processGitHubWebhook,
	processJiraWebhook,
	registerBuiltInTriggers,
} from './triggers/index.js';
import { processTrelloWebhook } from './triggers/trello/webhook-handler.js';
import { scrubSensitiveEnv } from './utils/envScrub.js';
import { logger, setLogLevel } from './utils/index.js';

interface TrelloJobData {
	type: 'trello';
	source: 'trello';
	payload: unknown;
	projectId: string;
	cardId: string;
	actionType: string;
	receivedAt: string;
	ackCommentId?: string;
}

interface GitHubJobData {
	type: 'github';
	source: 'github';
	payload: unknown;
	eventType: string;
	repoFullName: string;
	receivedAt: string;
	ackCommentId?: number;
	ackMessage?: string;
}

interface JiraJobData {
	type: 'jira';
	source: 'jira';
	payload: unknown;
	projectId: string;
	issueKey: string;
	webhookEvent: string;
	receivedAt: string;
	ackCommentId?: string;
}

interface ManualRunJobData {
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

interface RetryRunJobData {
	type: 'retry-run';
	runId: string;
	projectId: string;
	modelOverride?: string;
}

interface DebugAnalysisJobData {
	type: 'debug-analysis';
	runId: string;
	projectId: string;
	cardId?: string;
}

type DashboardJobData = ManualRunJobData | RetryRunJobData | DebugAnalysisJobData;

type JobData = TrelloJobData | GitHubJobData | JiraJobData | DashboardJobData;

async function processDashboardJob(jobId: string, jobData: DashboardJobData): Promise<void> {
	const { loadProjectConfigById } = await import('./config/provider.js');

	if (jobData.type === 'manual-run') {
		logger.info('[Worker] Processing manual-run job', {
			jobId,
			projectId: jobData.projectId,
			agentType: jobData.agentType,
		});
		const { triggerManualRun } = await import('./triggers/shared/manual-runner.js');
		const pc = await loadProjectConfigById(jobData.projectId);
		if (!pc) throw new Error(`Project not found: ${jobData.projectId}`);
		await triggerManualRun(
			{
				projectId: jobData.projectId,
				agentType: jobData.agentType,
				cardId: jobData.cardId,
				prNumber: jobData.prNumber,
				prBranch: jobData.prBranch,
				repoFullName: jobData.repoFullName,
				headSha: jobData.headSha,
				modelOverride: jobData.modelOverride,
			},
			pc.project,
			pc.config,
		);
	} else if (jobData.type === 'retry-run') {
		logger.info('[Worker] Processing retry-run job', { jobId, runId: jobData.runId });
		const { getRunById } = await import('./db/repositories/runsRepository.js');
		const { triggerRetryRun } = await import('./triggers/shared/manual-runner.js');
		const run = await getRunById(jobData.runId);
		if (!run?.projectId) throw new Error(`Run not found or has no project: ${jobData.runId}`);
		const pc = await loadProjectConfigById(run.projectId);
		if (!pc) throw new Error(`Project not found: ${run.projectId}`);
		await triggerRetryRun(jobData.runId, pc.project, pc.config, jobData.modelOverride);
	} else {
		logger.info('[Worker] Processing debug-analysis job', { jobId, runId: jobData.runId });
		const { triggerDebugAnalysis } = await import('./triggers/shared/debug-runner.js');
		const pc = await loadProjectConfigById(jobData.projectId);
		if (!pc) throw new Error(`Project not found: ${jobData.projectId}`);
		await triggerDebugAnalysis(jobData.runId, pc.project, pc.config, jobData.cardId);
	}
}

async function dispatchJob(
	jobId: string,
	jobData: JobData,
	triggerRegistry: TriggerRegistry,
): Promise<void> {
	switch (jobData.type) {
		case 'trello':
			logger.info('[Worker] Processing Trello job', {
				jobId,
				cardId: jobData.cardId,
				actionType: jobData.actionType,
				ackCommentId: jobData.ackCommentId,
			});
			await processTrelloWebhook(jobData.payload, triggerRegistry, jobData.ackCommentId);
			break;
		case 'github':
			logger.info('[Worker] Processing GitHub job', {
				jobId,
				eventType: jobData.eventType,
				repoFullName: jobData.repoFullName,
				ackCommentId: jobData.ackCommentId,
			});
			await processGitHubWebhook(
				jobData.payload,
				jobData.eventType,
				triggerRegistry,
				jobData.ackCommentId,
				jobData.ackMessage,
			);
			break;
		case 'jira':
			logger.info('[Worker] Processing JIRA job', {
				jobId,
				issueKey: jobData.issueKey,
				webhookEvent: jobData.webhookEvent,
				ackCommentId: jobData.ackCommentId,
			});
			await processJiraWebhook(jobData.payload, triggerRegistry, jobData.ackCommentId);
			break;
		case 'manual-run':
		case 'retry-run':
		case 'debug-analysis':
			await processDashboardJob(jobId, jobData);
			break;
		default: {
			const unknownType = (jobData as { type: string }).type;
			logger.error('[Worker] Unknown job type', { jobType: unknownType });
			captureException(new Error(`Unknown job type: ${unknownType}`), {
				tags: { source: 'worker_unknown_job' },
			});
			await flush();
			process.exit(1);
		}
	}
}

async function main(): Promise<void> {
	const jobId = process.env.JOB_ID;
	const jobType = process.env.JOB_TYPE;
	const jobDataRaw = process.env.JOB_DATA;

	setTag('role', 'worker');
	if (jobId) setTag('jobId', jobId);
	if (jobType) setTag('jobType', jobType);

	if (!jobId || !jobType || !jobDataRaw) {
		const err = new Error('Missing required environment variables: JOB_ID, JOB_TYPE, JOB_DATA');
		console.error(`[Worker] ${err.message}`);
		captureException(err, { tags: { source: 'worker_env' } });
		await flush();
		process.exit(1);
	}

	let jobData: JobData;
	try {
		jobData = JSON.parse(jobDataRaw);
	} catch (err) {
		console.error('[Worker] Failed to parse JOB_DATA:', err);
		captureException(err, { tags: { source: 'worker_job_parse' } });
		await flush();
		process.exit(1);
	}

	// Set Sentry tags from parsed job data
	if ('projectId' in jobData && jobData.projectId) setTag('projectId', jobData.projectId);
	if ('agentType' in jobData && jobData.agentType) setTag('agentType', jobData.agentType);

	// Load environment config
	const envConfig = loadEnvConfigSafe();
	setLogLevel(envConfig.logLevel);

	logger.info('[Worker] Starting job', { jobId, jobType });

	// Initialize database pool (caches connection string before we scrub DATABASE_URL)
	getDb();

	// Load projects config from database
	const config = await loadConfig();
	logger.info('[Worker] Loaded projects config', { projects: config.projects.map((p) => p.id) });

	// Credentials are set as individual env vars by the router (Docker env).
	// CASCADE_CREDENTIAL_KEYS lists the key names for reconstruction.
	if (!process.env.CASCADE_CREDENTIAL_KEYS) {
		logger.error('[Worker] No credentials passed from router - job will likely fail', {
			jobType: jobData.type,
		});
	}

	// SECURITY: Scrub sensitive env vars (DATABASE_URL, etc.)
	// before agent execution. Subprocesses (Tmux, etc.) will not inherit these secrets.
	scrubSensitiveEnv();
	logger.info('[Worker] Scrubbed sensitive env vars');

	// Create trigger registry
	const triggerRegistry = createTriggerRegistry();
	registerBuiltInTriggers(triggerRegistry);

	try {
		await dispatchJob(jobId, jobData, triggerRegistry);
		logger.info('[Worker] Job completed successfully', { jobId });
		await flush();
		process.exit(0);
	} catch (err) {
		logger.error('[Worker] Job failed', { jobId, error: String(err) });
		captureException(err, { tags: { source: 'worker_job_failure' } });
		await flush();
		process.exit(1);
	}
}

main().catch(async (err) => {
	console.error('[Worker] Unhandled error:', err);
	captureException(err, { tags: { source: 'worker_unhandled' }, level: 'fatal' });
	await flush();
	process.exit(1);
});
