/**
 * Worker environment variable builder for CASCADE worker containers.
 *
 * Handles job data parsing and env building — with zero Docker dependency.
 * Used by container-manager.ts when spawning worker containers.
 */

import type { Job } from 'bullmq';
import { findProjectByRepo, getAllProjectCredentials } from '../config/provider.js';
import { captureException } from '../sentry.js';
import { logger } from '../utils/logging.js';
import { routerConfig } from './config.js';
import type { CascadeJob } from './queue.js';

/**
 * Extract projectId from job data for credential resolution.
 * Different job types have the projectId in different locations.
 *
 * Note: Dashboard jobs (manual-run, retry-run, debug-analysis) come through
 * cascade-dashboard-jobs queue and are cast to CascadeJob for spawning.
 */
export async function extractProjectIdFromJob(data: CascadeJob): Promise<string | null> {
	// Use type assertion since dashboard jobs are cast to CascadeJob
	const jobData = data as unknown as { type: string; projectId?: string; repoFullName?: string };

	if (jobData.type === 'trello' || jobData.type === 'jira') {
		return jobData.projectId ?? null;
	}
	if (jobData.type === 'github') {
		if (!jobData.repoFullName) return null;
		const project = await findProjectByRepo(jobData.repoFullName);
		return project?.id ?? null;
	}
	if (jobData.type === 'manual-run' || jobData.type === 'debug-analysis') {
		return jobData.projectId ?? null;
	}
	if (jobData.type === 'retry-run') {
		// Retry jobs now include projectId from the API
		return jobData.projectId ?? null;
	}
	return null;
}

/**
 * Build environment variables for a worker container.
 * Resolves project credentials and forwards required infrastructure env vars.
 */
export async function buildWorkerEnv(job: Job<CascadeJob>): Promise<string[]> {
	const projectId = await extractProjectIdFromJob(job.data);
	return buildWorkerEnvWithProjectId(job, projectId);
}

/**
 * Append optional infrastructure env vars that are conditionally forwarded to workers.
 * Extracted to keep buildWorkerEnvWithProjectId within complexity limits.
 */
function appendOptionalEnvVars(env: string[]): void {
	// Forward DB SSL config so workers use the same TLS settings as the router.
	if (process.env.DATABASE_SSL) env.push(`DATABASE_SSL=${process.env.DATABASE_SSL}`);
	if (process.env.DATABASE_CA_CERT) env.push(`DATABASE_CA_CERT=${process.env.DATABASE_CA_CERT}`);

	// CLAUDE_CODE_OAUTH_TOKEN is for the Claude Code backend (subscription auth).
	if (process.env.CLAUDE_CODE_OAUTH_TOKEN)
		env.push(`CLAUDE_CODE_OAUTH_TOKEN=${process.env.CLAUDE_CODE_OAUTH_TOKEN}`);

	// Forward Sentry env vars so worker containers report to the same project.
	if (process.env.SENTRY_DSN) env.push(`SENTRY_DSN=${process.env.SENTRY_DSN}`);
	if (process.env.SENTRY_ENVIRONMENT)
		env.push(`SENTRY_ENVIRONMENT=${process.env.SENTRY_ENVIRONMENT}`);
	if (process.env.SENTRY_RELEASE) env.push(`SENTRY_RELEASE=${process.env.SENTRY_RELEASE}`);

	// Forward dashboard URL so worker progress comments can include run links.
	if (process.env.CASCADE_DASHBOARD_URL)
		env.push(`CASCADE_DASHBOARD_URL=${process.env.CASCADE_DASHBOARD_URL}`);
}

/**
 * Build environment variables for a worker container with a pre-resolved projectId.
 * @internal Used by container-manager.ts to avoid resolving projectId twice.
 */
export async function buildWorkerEnvWithProjectId(
	job: Job<CascadeJob>,
	projectId: string | null,
): Promise<string[]> {
	const env: string[] = [
		`JOB_ID=${job.id}`,
		`JOB_TYPE=${job.data.type}`,
		`JOB_DATA=${JSON.stringify(job.data)}`,
		// Redis for job completion reporting
		`REDIS_URL=${routerConfig.redisUrl}`,
		// Database connection
		`CASCADE_POSTGRES_HOST=${process.env.CASCADE_POSTGRES_HOST || 'postgres'}`,
		`CASCADE_POSTGRES_PORT=${process.env.CASCADE_POSTGRES_PORT || '5432'}`,
		// Database connection for config
		`DATABASE_URL=${process.env.DATABASE_URL || ''}`,
		// Logging
		`LOG_LEVEL=${process.env.LOG_LEVEL || 'info'}`,
	];

	// Resolve project credentials in the router and set as individual env vars.
	// NOTE: CREDENTIAL_MASTER_KEY is intentionally NOT passed to workers.
	if (projectId) {
		try {
			const secrets = await getAllProjectCredentials(projectId);
			for (const [key, value] of Object.entries(secrets)) {
				env.push(`${key}=${value}`);
			}
			env.push(`CASCADE_CREDENTIAL_KEYS=${Object.keys(secrets).join(',')}`);
		} catch (err) {
			logger.warn('[WorkerManager] Failed to resolve credentials for project:', {
				projectId,
				error: String(err),
			});
			captureException(err, {
				tags: { source: 'credential_resolution' },
				extra: { projectId },
				level: 'warning',
			});
		}
	}

	appendOptionalEnvVars(env);

	return env;
}

/**
 * Extract work-item ID from job data for concurrency lock tracking.
 * Returns the PM work item identifier (workItemId, issueKey, or triggerResult.workItemId).
 */
export function extractWorkItemId(data: CascadeJob): string | undefined {
	const jobData = data as unknown as {
		type: string;
		workItemId?: string;
		issueKey?: string;
		triggerResult?: { workItemId?: string };
	};

	if (jobData.type === 'trello' && jobData.workItemId) return jobData.workItemId;
	if (jobData.type === 'jira' && jobData.issueKey) return jobData.issueKey;
	if (jobData.type === 'github') return jobData.triggerResult?.workItemId;
	// Dashboard jobs (manual-run, retry-run, debug-analysis)
	if (jobData.workItemId) return jobData.workItemId;
	return undefined;
}

/**
 * Extract agent type from job data for concurrency lock tracking.
 * Checks triggerResult.agentType first, then top-level agentType (dashboard jobs).
 */
export function extractAgentType(data: CascadeJob): string | undefined {
	const jobData = data as unknown as {
		triggerResult?: { agentType?: string };
		agentType?: string;
	};
	return jobData.triggerResult?.agentType ?? jobData.agentType ?? undefined;
}
