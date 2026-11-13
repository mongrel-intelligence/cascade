/**
 * Worker environment variable builder for CASCADE worker containers.
 *
 * Handles job data parsing and env building — with zero Docker dependency.
 * Used by container-manager.ts when spawning worker containers.
 */

import type { Job } from 'bullmq';
import { DEFAULT_ENGINE, resolveEngineName } from '../backends/resolution.js';
import {
	findProjectById,
	findProjectByRepo,
	getAllProjectCredentials,
} from '../config/provider.js';
import {
	hasEnabledSubscription,
	selectBestSubscription,
	selectLeastExhaustedSubscription,
} from '../db/repositories/subscriptionsRepository.js';
import { extractProjectIdFromJobViaRegistry } from '../integrations/pm/_shared/project-id-extractor.js';
import { captureException } from '../sentry.js';
import { logger } from '../utils/logging.js';
import { routerConfig } from './config.js';
import {
	buildJobDataRedisKey,
	JOB_DATA_INLINE_MAX_BYTES,
	offloadJobData,
} from './job-data-offload.js';
import type { CascadeJob } from './queue.js';

/**
 * Extract projectId from job data for credential resolution.
 * Different job types have the projectId in different locations.
 *
 * Resolution order:
 *   1. PM provider manifest registry — any registered PM provider whose
 *      `extractProjectIdFromJob` returns non-null wins. Plan 006/1 lands this
 *      path; plans 006/2–006/4 migrate real providers into it.
 *   2. Legacy per-provider branches below — kept during the migration window.
 *
 * Note: Dashboard jobs (manual-run, retry-run, debug-analysis) come through
 * cascade-dashboard-jobs queue and are cast to CascadeJob for spawning.
 */
export async function extractProjectIdFromJob(data: CascadeJob): Promise<string | null> {
	// Manifest registry first — dormant during plan 006/1 because no real
	// providers register here yet, so this returns null and we fall through.
	const fromRegistry = await extractProjectIdFromJobViaRegistry(data);
	if (fromRegistry !== null) return fromRegistry;

	// Use type assertion since dashboard jobs are cast to CascadeJob
	const jobData = data as unknown as { type: string; projectId?: string; repoFullName?: string };

	// All PM providers (trello / jira / linear) now route through the
	// manifest registry above. Non-PM job types remain below.
	if (jobData.type === 'github') {
		// The router stamps the project it resolved (link-first on shared
		// repositories, spec 024). Prefer it: re-deriving from the repo alone
		// takes the first match, which need not own this PR.
		if (jobData.projectId) return jobData.projectId;
		// Jobs enqueued before that shipped carry no projectId. Dropping them
		// would be worse than the ambiguity this replaces.
		if (!jobData.repoFullName) return null;
		const project = await findProjectByRepo(jobData.repoFullName);
		return project?.id ?? null;
	}
	if (jobData.type === 'sentry') {
		return jobData.projectId ?? null;
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
function appendOptionalEnvVars(env: string[], opts: { skipGlobalClaudeToken: boolean }): void {
	// Forward DB SSL config so workers use the same TLS settings as the router.
	if (process.env.DATABASE_SSL) env.push(`DATABASE_SSL=${process.env.DATABASE_SSL}`);
	if (process.env.DATABASE_CA_CERT) env.push(`DATABASE_CA_CERT=${process.env.DATABASE_CA_CERT}`);

	// CLAUDE_CODE_OAUTH_TOKEN is for the Claude Code backend (subscription auth).
	// Skipped when a project subscription token was injected, to avoid a duplicate env key.
	if (process.env.CLAUDE_CODE_OAUTH_TOKEN && !opts.skipGlobalClaudeToken)
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

export const SUBSCRIPTION_ENV_KEY = 'CASCADE_SUBSCRIPTION_ID';

/** Parse the Claude subscription id the router actually injected into a worker env. */
export function extractSubscriptionIdFromEnv(env: string[]): number | undefined {
	const line = env.find((e) => e.startsWith(`${SUBSCRIPTION_ENV_KEY}=`));
	const id = line ? Number.parseInt(line.slice(SUBSCRIPTION_ENV_KEY.length + 1), 10) : Number.NaN;
	return Number.isInteger(id) && id > 0 ? id : undefined;
}

/**
 * Pick a Claude subscription for this job and inject it into `secrets`/`env`.
 * Returns true when a subscription token was injected. Projects without an enabled
 * subscription do nothing beyond the hasEnabledSubscription query.
 */
async function injectClaudeSubscription(
	job: Job<CascadeJob>,
	projectId: string,
	secrets: Record<string, string>,
	env: string[],
): Promise<boolean> {
	if (!(await hasEnabledSubscription(projectId))) return false;

	const agentType = extractAgentType(job.data);
	const project = await findProjectById(projectId);
	const engine = !project
		? DEFAULT_ENGINE
		: agentType
			? resolveEngineName(agentType, project)
			: (project.agentEngine?.default ?? DEFAULT_ENGINE);
	if (engine !== 'claude-code') {
		logger.debug('[WorkerManager] Engine is not claude-code; no subscription', {
			jobId: job.id,
			projectId,
			engine,
		});
		return false;
	}
	if (secrets.ANTHROPIC_API_KEY) {
		// With an API key, plan limits and rate_limit_event data do not apply.
		logger.warn(
			'[WorkerManager] Project has ANTHROPIC_API_KEY; Claude subscriptions are not injected',
			{ projectId },
		);
		return false;
	}

	const excluded =
		(job.data as { excludedSubscriptionIds?: number[] }).excludedSubscriptionIds ?? [];
	let sub = await selectBestSubscription(projectId, excluded);
	if (!sub) {
		// None eligible: still run on a managed subscription so exit 3 + delayed retry apply.
		sub = await selectLeastExhaustedSubscription(projectId);
		if (sub) {
			logger.warn(
				'[WorkerManager] No eligible Claude subscription; using least-exhausted for failover',
				{ jobId: job.id, projectId, subscriptionId: sub.id },
			);
		}
	}
	if (!sub) return false;

	secrets.CLAUDE_CODE_OAUTH_TOKEN = sub.token;
	env.push(`${SUBSCRIPTION_ENV_KEY}=${sub.id}`);
	logger.info('[WorkerManager] Selected Claude subscription', {
		jobId: job.id,
		projectId,
		subscriptionId: sub.id,
	});
	return true;
}

/**
 * Build environment variables for a worker container with a pre-resolved projectId.
 * @internal Used by container-manager.ts to avoid resolving projectId twice.
 *
 * @param snapshotReuse - When true, injects CASCADE_SNAPSHOT_REUSE=true so the
 *   worker knows to refresh an existing workspace instead of cloning from scratch.
 * @param snapshotEnabled - When true, injects CASCADE_SNAPSHOT_ENABLED=true so the
 *   worker preserves its workspace on exit (the router will commit the container to
 *   a snapshot image after the worker exits).
 */
export async function buildWorkerEnvWithProjectId(
	job: Job<CascadeJob>,
	projectId: string | null,
	snapshotReuse = false,
	snapshotEnabled = false,
): Promise<string[]> {
	const env: string[] = [
		`JOB_ID=${job.id}`,
		`JOB_TYPE=${job.data.type}`,
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

	// Pass the job payload inline when it fits under the OS arg-size limit; an
	// env/argv string over MAX_ARG_STRLEN (128 KiB) makes the kernel reject the
	// container entrypoint exec with "argument list too long" before any JS runs
	// (prod incident ucho/MNG-1660). Oversized payloads are offloaded to Redis
	// and the worker reads them back via JOB_DATA_REDIS_KEY (see worker-entry.ts).
	const serialized = JSON.stringify(job.data);
	const jobDataBytes = Buffer.byteLength(serialized, 'utf8');
	if (jobDataBytes <= JOB_DATA_INLINE_MAX_BYTES) {
		env.push(`JOB_DATA=${serialized}`);
	} else {
		await offloadJobData(String(job.id), serialized);
		env.push(`JOB_DATA_REDIS_KEY=${buildJobDataRedisKey(String(job.id))}`);
		logger.info('[WorkerManager] Offloaded large JOB_DATA to Redis', {
			jobId: job.id,
			bytes: jobDataBytes,
		});
	}

	// Signal snapshot reuse so the worker skips redundant setup (clone, install).
	if (snapshotReuse) {
		env.push('CASCADE_SNAPSHOT_REUSE=true');
	}

	// Signal that this container will be committed to a snapshot image after exit.
	// The worker must NOT delete its workspace so the directory is present when the
	// router calls docker commit (after container.wait() resolves).
	if (snapshotEnabled) {
		env.push('CASCADE_SNAPSHOT_ENABLED=true');
	}

	// Resolve project credentials in the router and set as individual env vars.
	// NOTE: CREDENTIAL_MASTER_KEY is intentionally NOT passed to workers.
	let subscriptionInjected = false;
	if (projectId) {
		try {
			const secrets = await getAllProjectCredentials(projectId);
			// Subscription lookup failures must never take the other credentials down with it.
			try {
				subscriptionInjected = await injectClaudeSubscription(job, projectId, secrets, env);
			} catch (err) {
				logger.warn('[WorkerManager] Subscription selection failed, using project credentials', {
					projectId,
					error: String(err),
				});
				captureException(err, {
					tags: { source: 'subscription_selection' },
					extra: { projectId },
					level: 'warning',
				});
			}
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

	appendOptionalEnvVars(env, { skipGlobalClaudeToken: subscriptionInjected });

	return env;
}

/**
 * Extract work-item ID from job data for concurrency lock tracking.
 * Returns the PM work item identifier (workItemId, issueKey, or triggerResult.workItemId).
 *
 * For Sentry jobs that deferred PM card materialisation to the worker, the
 * trigger result may have `lockKey` set instead of `workItemId`. The lock was
 * registered in the router using `lockKey ?? workItemId`, so the compensator
 * must clear the same key.
 */
export function extractWorkItemId(data: CascadeJob): string | undefined {
	const jobData = data as unknown as {
		type: string;
		workItemId?: string;
		issueKey?: string;
		triggerResult?: { workItemId?: string; lockKey?: string };
	};

	if (jobData.type === 'trello' && jobData.workItemId) return jobData.workItemId;
	if (jobData.type === 'jira' && jobData.issueKey) return jobData.issueKey;
	if (jobData.type === 'github') return jobData.triggerResult?.workItemId;
	if (jobData.type === 'linear') return jobData.triggerResult?.workItemId ?? jobData.workItemId;
	// Sentry jobs: lockKey takes priority (set when workItemId is deferred to the worker)
	if (jobData.type === 'sentry') {
		return jobData.triggerResult?.lockKey ?? jobData.triggerResult?.workItemId;
	}
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
