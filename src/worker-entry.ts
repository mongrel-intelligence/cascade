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

import { configCache } from './config/configCache.js';
import { loadEnvConfigSafe } from './config/env.js';
import { loadConfig } from './config/provider.js';
import { getDb } from './db/client.js';
import {
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
}

interface GitHubJobData {
	type: 'github';
	source: 'github';
	payload: unknown;
	eventType: string;
	repoFullName: string;
	receivedAt: string;
}

interface JiraJobData {
	type: 'jira';
	source: 'jira';
	payload: unknown;
	projectId: string;
	issueKey: string;
	webhookEvent: string;
	receivedAt: string;
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

async function main(): Promise<void> {
	const jobId = process.env.JOB_ID;
	const jobType = process.env.JOB_TYPE;
	const jobDataRaw = process.env.JOB_DATA;

	if (!jobId || !jobType || !jobDataRaw) {
		console.error('[Worker] Missing required environment variables: JOB_ID, JOB_TYPE, JOB_DATA');
		process.exit(1);
	}

	let jobData: JobData;
	try {
		jobData = JSON.parse(jobDataRaw);
	} catch (err) {
		console.error('[Worker] Failed to parse JOB_DATA:', err);
		process.exit(1);
	}

	// Load environment config
	const envConfig = loadEnvConfigSafe();
	setLogLevel(envConfig.logLevel);

	logger.info('[Worker] Starting job', { jobId, jobType });

	// Initialize database pool (caches connection string before we scrub DATABASE_URL)
	getDb();

	// Load projects config from database
	const config = await loadConfig();
	logger.info('[Worker] Loaded projects config', { projects: config.projects.map((p) => p.id) });

	// Cache credentials from router (passed as JSON in CASCADE_CREDENTIALS).
	// Router resolves and decrypts credentials before spawning workers, so workers
	// never need the CREDENTIAL_MASTER_KEY.
	const credentialsJson = process.env.CASCADE_CREDENTIALS;
	const credentialsProjectId = process.env.CASCADE_CREDENTIALS_PROJECT_ID;
	if (credentialsJson && credentialsProjectId) {
		try {
			const secrets = JSON.parse(credentialsJson) as Record<string, string>;
			configCache.setSecrets(credentialsProjectId, secrets);
			logger.info('[Worker] Cached credentials from router', { projectId: credentialsProjectId });
		} catch (err) {
			logger.warn('[Worker] Failed to parse CASCADE_CREDENTIALS', { error: String(err) });
		}
	} else {
		// All jobs MUST have credentials passed from router
		logger.error('[Worker] No credentials passed from router - job will likely fail', {
			jobType: jobData.type,
		});
	}

	// SECURITY: Scrub sensitive env vars (DATABASE_URL, CASCADE_CREDENTIALS, etc.)
	// before agent execution. Subprocesses (Tmux, etc.) will not inherit these secrets.
	scrubSensitiveEnv();
	logger.info('[Worker] Scrubbed sensitive env vars');

	// Create trigger registry
	const triggerRegistry = createTriggerRegistry();
	registerBuiltInTriggers(triggerRegistry);

	try {
		if (jobData.type === 'trello') {
			logger.info('[Worker] Processing Trello job', {
				jobId,
				cardId: jobData.cardId,
				actionType: jobData.actionType,
			});
			await processTrelloWebhook(jobData.payload, triggerRegistry);
		} else if (jobData.type === 'github') {
			logger.info('[Worker] Processing GitHub job', {
				jobId,
				eventType: jobData.eventType,
				repoFullName: jobData.repoFullName,
			});
			await processGitHubWebhook(jobData.payload, jobData.eventType, triggerRegistry);
		} else if (jobData.type === 'jira') {
			logger.info('[Worker] Processing JIRA job', {
				jobId,
				issueKey: jobData.issueKey,
				webhookEvent: jobData.webhookEvent,
			});
			await processJiraWebhook(jobData.payload, triggerRegistry);
		} else if (
			jobData.type === 'manual-run' ||
			jobData.type === 'retry-run' ||
			jobData.type === 'debug-analysis'
		) {
			await processDashboardJob(jobId, jobData);
		} else {
			logger.error('[Worker] Unknown job type', { jobType: (jobData as { type: string }).type });
			process.exit(1);
		}

		logger.info('[Worker] Job completed successfully', { jobId });
		process.exit(0);
	} catch (err) {
		logger.error('[Worker] Job failed', { jobId, error: String(err) });
		process.exit(1);
	}
}

main().catch((err) => {
	console.error('[Worker] Unhandled error:', err);
	process.exit(1);
});
