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

// Bootstrap all integrations via the single canonical entrypoint. See
// src/integrations/entrypoint.ts — one file, consumed by router, worker,
// CLI, and dashboard, so a new provider can never be registered in some
// runtime surfaces but not others.
import './integrations/entrypoint.js';
import { BootFailureError } from './agents/shared/bootFailureError.js';
import { registerBuiltInEngines } from './backends/bootstrap.js';
import { loadEnvConfigSafe } from './config/env.js';
import { loadConfig } from './config/provider.js';
import { getDb } from './db/client.js';
import {
	extractJiraContext,
	extractLinearContext,
	extractTrelloContext,
	generateAckMessage,
} from './router/ackMessageGenerator.js';
import { readOffloadedJobData } from './router/job-data-offload.js';
import { dispatchPMAck } from './router/pm-ack-dispatch.js';
import { captureException, flush, setTag } from './sentry.js';
import {
	createTriggerRegistry,
	processGitHubWebhook,
	processJiraWebhook,
	registerBuiltInTriggers,
	type TriggerRegistry,
} from './triggers/index.js';
import { processLinearWebhook } from './triggers/linear/webhook-handler.js';
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
	mergeabilityRecheckAttempt?: number;
	/**
	 * Set to 1 when this job is a check-suite deferred re-check.
	 * Unlike mergeabilityRecheckAttempt, a second deferredRecheck result
	 * causes processGitHubWebhook to reschedule rather than exhaust.
	 */
	checkSuiteRecheckAttempt?: number;
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

export interface LinearJobData {
	type: 'linear';
	source: 'linear';
	payload: unknown;
	projectId: string;
	workItemId?: string;
	/** Linear event type: e.g. 'create/Issue', 'update/Issue', 'create/Comment' */
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

export interface ManualRunJobData {
	type: 'manual-run';
	projectId: string;
	agentType: string;
	workItemId?: string;
	workItemUrl?: string;
	workItemTitle?: string;
	prNumber?: number;
	prBranch?: string;
	repoFullName?: string;
	headSha?: string;
	modelOverride?: string;
	triggerCommentBody?: string;
	triggerCommentId?: number;
	triggerCommentUrl?: string;
	triggerCommentPath?: string;
	triggerCommentAuthor?: string;
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
	| LinearJobData
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
				workItemUrl: jobData.workItemUrl,
				workItemTitle: jobData.workItemTitle,
				prNumber: jobData.prNumber,
				prBranch: jobData.prBranch,
				repoFullName: jobData.repoFullName,
				headSha: jobData.headSha,
				modelOverride: jobData.modelOverride,
				triggerCommentBody: jobData.triggerCommentBody,
				triggerCommentId: jobData.triggerCommentId,
				triggerCommentUrl: jobData.triggerCommentUrl,
				triggerCommentPath: jobData.triggerCommentPath,
				triggerCommentAuthor: jobData.triggerCommentAuthor,
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

/**
 * Post the deferred acknowledgment comment for a coalesced PM job.
 *
 * Called at job fire time when `pendingAck=true`. Extracts a context snippet
 * from the stored webhook payload, calls `generateAckMessage()` to produce a
 * proper role-aware message (same path as the non-coalesced `postAck`), then
 * posts it via `dispatchPMAck`. Returns the new comment ID string, or
 * `undefined` if the ack could not be posted (non-fatal).
 *
 * The stored `ackContextHint` field contains the `workItemTitle` as a fallback
 * for `generateAckMessage` when payload extraction returns nothing.
 */
async function postDeferredAck(
	projectId: string,
	workItemId: string,
	pmType: 'trello' | 'jira' | 'linear',
	payload: unknown,
	agentType: string | undefined,
	contextHint: string | undefined,
): Promise<string | undefined> {
	// Extract context from the raw payload (same source as the non-coalesced postAck path).
	let contextSnippet =
		pmType === 'jira'
			? extractJiraContext(payload)
			: pmType === 'linear'
				? extractLinearContext(payload)
				: extractTrelloContext(payload);

	// Fall back to the stored workItemTitle hint when the extractor yields nothing.
	if (!contextSnippet && contextHint) {
		contextSnippet = `Issue: ${contextHint}`;
	}

	const message = await generateAckMessage(agentType ?? '', contextSnippet, projectId);

	const ackResult = await dispatchPMAck({
		projectId,
		workItemId,
		pmType,
		message,
		agentType,
	}).catch((err) => {
		logger.warn(`[Worker] Deferred ${pmType} ack failed (non-fatal)`, { error: String(err) });
		return undefined;
	});

	return ackResult?.commentId != null ? String(ackResult.commentId) : undefined;
}

export async function dispatchJob(
	jobId: string,
	jobData: JobData,
	triggerRegistry: TriggerRegistry,
): Promise<void> {
	switch (jobData.type) {
		case 'trello': {
			logger.info('[Worker] Processing Trello job', {
				jobId,
				workItemId: jobData.workItemId,
				actionType: jobData.actionType,
				ackCommentId: jobData.ackCommentId,
				pendingAck: jobData.pendingAck,
				hasTriggerResult: !!jobData.triggerResult,
			});
			// Deferred ack: post the ack comment that was skipped at schedule time.
			let trelloAckCommentId = jobData.ackCommentId;
			if (jobData.pendingAck) {
				trelloAckCommentId =
					(await postDeferredAck(
						jobData.projectId,
						jobData.workItemId,
						'trello',
						jobData.payload,
						jobData.triggerResult?.agentType ?? undefined,
						jobData.ackContextHint,
					)) ?? trelloAckCommentId;
			}
			await processTrelloWebhook(
				jobData.payload,
				triggerRegistry,
				trelloAckCommentId,
				jobData.triggerResult,
				jobData.projectId,
			);
			break;
		}
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
				!!jobData.mergeabilityRecheckAttempt,
				!!jobData.checkSuiteRecheckAttempt,
			);
			break;
		case 'jira': {
			logger.info('[Worker] Processing JIRA job', {
				jobId,
				issueKey: jobData.issueKey,
				webhookEvent: jobData.webhookEvent,
				ackCommentId: jobData.ackCommentId,
				pendingAck: jobData.pendingAck,
				hasTriggerResult: !!jobData.triggerResult,
			});
			// Deferred ack: post the ack comment that was skipped at schedule time.
			let jiraAckCommentId = jobData.ackCommentId;
			if (jobData.pendingAck) {
				jiraAckCommentId =
					(await postDeferredAck(
						jobData.projectId,
						jobData.issueKey,
						'jira',
						jobData.payload,
						jobData.triggerResult?.agentType ?? undefined,
						jobData.ackContextHint,
					)) ?? jiraAckCommentId;
			}
			await processJiraWebhook(
				jobData.payload,
				triggerRegistry,
				jiraAckCommentId,
				jobData.triggerResult,
				jobData.projectId,
			);
			break;
		}
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
		case 'linear': {
			logger.info('[Worker] Processing Linear job', {
				jobId,
				projectId: jobData.projectId,
				workItemId: jobData.workItemId,
				eventType: jobData.eventType,
				ackCommentId: jobData.ackCommentId,
				pendingAck: jobData.pendingAck,
				hasTriggerResult: !!jobData.triggerResult,
			});
			// Deferred ack: post the ack comment that was skipped at schedule time.
			let linearAckCommentId = jobData.ackCommentId;
			if (jobData.pendingAck && jobData.workItemId) {
				linearAckCommentId =
					(await postDeferredAck(
						jobData.projectId,
						jobData.workItemId,
						'linear',
						jobData.payload,
						jobData.triggerResult?.agentType ?? undefined,
						jobData.ackContextHint,
					)) ?? linearAckCommentId;
			}
			await processLinearWebhook(
				jobData.payload,
				triggerRegistry,
				linearAckCommentId,
				jobData.triggerResult,
				jobData.projectId,
			);
			break;
		}
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

/**
 * Resolve the raw JOB_DATA JSON string from either the inline env var or the
 * Redis offload key (prod incident ucho/MNG-1660). Large payloads are stored in
 * Redis by the router instead of inline, because an env string over the OS
 * MAX_ARG_STRLEN (128 KiB) makes the kernel reject the container entrypoint exec
 * with "argument list too long". Must run before scrubSensitiveEnv() strips
 * REDIS_URL. Exits the process with a clear, grep-able reason on any failure —
 * never the cryptic exec crash, never a payload-less worker.
 */
async function resolveRawJobData(): Promise<string> {
	const inline = process.env.JOB_DATA;
	if (inline) return inline;

	const key = process.env.JOB_DATA_REDIS_KEY;
	if (!key) {
		// Defensive: main() validates that JOB_DATA or JOB_DATA_REDIS_KEY is present.
		const err = new Error('JOB_DATA could not be resolved from env or Redis');
		console.error(`[Worker] ${err.message}`);
		captureException(err, { tags: { source: 'worker_env' } });
		await flush();
		process.exit(1);
	}

	try {
		return await readOffloadedJobData(key);
	} catch (err) {
		console.error('[Worker] Failed to read offloaded JOB_DATA from Redis:', err);
		captureException(err, { tags: { source: 'worker_job_data_redis_read' } });
		await flush();
		process.exit(1);
	}
}

export async function main(): Promise<void> {
	const jobId = process.env.JOB_ID;
	const jobType = process.env.JOB_TYPE;
	const jobDataRaw = process.env.JOB_DATA;
	const jobDataRedisKey = process.env.JOB_DATA_REDIS_KEY;

	setTag('role', 'worker');
	if (jobId) setTag('jobId', jobId);
	if (jobType) setTag('jobType', jobType);

	if (!jobId || !jobType || (!jobDataRaw && !jobDataRedisKey)) {
		const err = new Error(
			'Missing required environment variables: JOB_ID, JOB_TYPE, JOB_DATA (or JOB_DATA_REDIS_KEY)',
		);
		console.error(`[Worker] ${err.message}`);
		captureException(err, { tags: { source: 'worker_env' } });
		await flush();
		process.exit(1);
	}

	const resolvedJobData = await resolveRawJobData();

	let jobData: JobData;
	try {
		jobData = JSON.parse(resolvedJobData);
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
		// Spec 018: distinguish boot-time failures (template load, plan
		// resolution, context-pipeline assembly) from in-execution crashes
		// via a dedicated exit code. The router's crash-reason interpreter
		// surfaces "Worker boot failed" for exit code 2; BullMQ's failure
		// compensation (spec 015) handles both equivalently.
		if (err instanceof BootFailureError) {
			logger.error('[Worker] Job failed at boot', {
				jobId,
				phase: err.phase,
				error: String(err),
			});
			// Sentry capture already happened inside the shared pipeline's
			// catch handler under tag `worker_boot_failure`; no need to
			// re-capture here.
			await flush();
			process.exit(2);
		}
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
