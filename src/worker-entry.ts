/**
 * Worker Entry Point
 *
 * This is the entry point for Cascade worker containers. It:
 * 1. Reads job data from environment variables
 * 2. Processes the job (Trello or GitHub webhook)
 * 3. Exits when complete
 *
 * Environment variables:
 * - JOB_ID: Unique job identifier
 * - JOB_TYPE: 'trello' or 'github'
 * - JOB_DATA: JSON-encoded job payload
 * - DATABASE_URL: PostgreSQL connection string for config
 */

import { loadEnvConfigSafe } from './config/env.js';
import { loadConfig } from './config/provider.js';
import {
	createTriggerRegistry,
	processGitHubWebhook,
	registerBuiltInTriggers,
} from './triggers/index.js';
import { processTrelloWebhook } from './triggers/trello/webhook-handler.js';
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

type JobData = TrelloJobData | GitHubJobData;

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

	// Load projects config from database
	const config = await loadConfig();
	logger.info('[Worker] Loaded projects config', { projects: config.projects.map((p) => p.id) });

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
