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

// Bootstrap all integrations before processing any jobs
import './integrations/bootstrap.js';
import { registerBuiltInEngines } from './backends/bootstrap.js';
import { loadEnvConfigSafe } from './config/env.js';
import { loadConfig } from './config/provider.js';
import { getDb } from './db/client.js';
import { captureException, flush, setTag } from './sentry.js';
import {
	createTriggerRegistry,
	processGitHubWebhook,
	processJiraWebhook,
	registerBuiltInTriggers,
	type TriggerRegistry,
} from './triggers/index.js';
import { processSentryWebhook } from './triggers/sentry/webhook-handler.js';
import { processTrelloWebhook } from './triggers/trello/webhook-handler.js';
import type { TriggerResult } from './types/index.js';
import { scrubSensitiveEnv } from './utils/envScrub.js';
import { logger, setLogLevel } from './utils/index.js';

export interface TrelloJobData {
	type: 'trello';
	source: 'trello';
	payload: unknown;
	projectId: string;
	workItemId: string;
	actionType: string;
	receivedAt: string;
	ackCommentId?: string;
	triggerResult?: TriggerResult;
}

export interface GitHubJobData {
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

export interface JiraJobData {
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

export interface SentryJobData {
	type: 'sentry';
	source: 'sentry';
	payload: unknown;
	projectId: string;
	/** Sentry resource type: 'event_alert' | 'metric_alert' | 'issue' */
	eventType: string;
	receivedAt: string;
	triggerResult?: TriggerResult;
}

export interface ManualRunJobData {
	type: 'manual-run';
	projectId: string;
	agentType: string;
	workItemId?: string;
	prNumber?: number;
	prBranch?: string;
	repoFullName?: string;
	headSha?: string;
	modelOverride?: string;
}

export interface RetryRunJobData {
	type: 'retry-run';
	runId: string;
	projectId: string;
	modelOverride?: string;
}

export interface DebugAnalysisJobData {
	type: 'debug-analysis';
	runId: string;
	projectId: string;
	workItemId?: string;
}

export type DashboardJobData = ManualRunJobData | RetryRunJobData | DebugAnalysisJobData;

export type JobData =
	| TrelloJobData
	| GitHubJobData
	| JiraJobData
	| SentryJobData
	| DashboardJobData;

export async function processDashboardJob(jobId: string, jobData: DashboardJobData): Promise<void> {
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
				workItemId: jobData.workItemId,
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
		await triggerDebugAnalysis(jobData.runId, pc.project, pc.config, jobData.workItemId);
	}
}

export async function dispatchJob(
	jobId: string,
	jobData: JobData,
	triggerRegistry: TriggerRegistry,
): Promise<void> {
	switch (jobData.type) {
		case 'trello':
			logger.info('[Worker] Processing Trello job', {
				jobId,
				workItemId: jobData.workItemId,
				actionType: jobData.actionType,
				ackCommentId: jobData.ackCommentId,
				hasTriggerResult: !!jobData.triggerResult,
			});
			await processTrelloWebhook(
				jobData.payload,
				triggerRegistry,
				jobData.ackCommentId,
				jobData.triggerResult,
			);
			break;
		case 'github':
			logger.info('[Worker] Processing GitHub job', {
				jobId,
				eventType: jobData.eventType,
				repoFullName: jobData.repoFullName,
				ackCommentId: jobData.ackCommentId,
				hasTriggerResult: !!jobData.triggerResult,
			});
			await processGitHubWebhook(
				jobData.payload,
				jobData.eventType,
				triggerRegistry,
				jobData.ackCommentId,
				jobData.ackMessage,
				jobData.triggerResult,
			);
			break;
		case 'jira':
			logger.info('[Worker] Processing JIRA job', {
				jobId,
				issueKey: jobData.issueKey,
				webhookEvent: jobData.webhookEvent,
				ackCommentId: jobData.ackCommentId,
				hasTriggerResult: !!jobData.triggerResult,
			});
			await processJiraWebhook(
				jobData.payload,
				triggerRegistry,
				jobData.ackCommentId,
				jobData.triggerResult,
			);
			break;
		case 'sentry':
			logger.info('[Worker] Processing Sentry job', {
				jobId,
				projectId: jobData.projectId,
				eventType: jobData.eventType,
				hasTriggerResult: !!jobData.triggerResult,
			});
			await processSentryWebhook(
				jobData.payload,
				jobData.projectId,
				triggerRegistry,
				jobData.triggerResult,
			);
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

export async function main(): Promise<void> {
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

	// Register engine settings schemas before loadConfig() runs EngineSettingsSchema.
	// Same fix as dashboard (#896) and router (#899).
	registerBuiltInEngines();

	// Load projects config from database
	const config = await loadConfig();
	logger.info('[Worker] Loaded projects config', { projects: config.projects.map((p) => p.id) });

	// Seed built-in agent definitions to DB, then initialize in-memory caches
	const { seedAgentDefinitions } = await import('./db/seeds/seedAgentDefinitions.js');
	const { initAgentMessages } = await import('./config/agentMessages.js');
	const { initPrompts } = await import('./agents/prompts/index.js');
	logger.info('[Worker] Seeding agent definitions...');
	await seedAgentDefinitions();
	logger.info('[Worker] Initializing agent messages...');
	await initAgentMessages();
	await initPrompts();

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

// Only auto-run when executed as an entry point, not when imported by tests.
if (!process.env.VITEST) {
	main().catch(async (err) => {
		console.error('[Worker] Unhandled error:', err);
		captureException(err, { tags: { source: 'worker_unhandled' }, level: 'fatal' });
		await flush();
		process.exit(1);
	});
}
