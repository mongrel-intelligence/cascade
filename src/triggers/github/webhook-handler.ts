/**
 * GitHub webhook handler.
 *
 * Thin orchestrator that delegates to focused modules:
 * - Ack comment management → ./ack-comments.ts
 * - CI check polling → ./check-polling.ts
 * - Credential scoping + agent execution → ../shared/webhook-execution.ts
 * - GitHub-specific AgentExecutionConfig → ./integration.ts
 * - Agent-type concurrency → ../shared/concurrency.ts
 * - PM credential scope → ../shared/credential-scope.ts
 * - PM ack posting → ../shared/pm-ack.ts
 */

import { isPMFocusedAgent } from '../../agents/definitions/loader.js';
import { loadProjectConfigById } from '../../config/provider.js';
import { withGitHubToken } from '../../github/client.js';
import { getPersonaToken, resolvePersonaIdentities } from '../../github/personas.js';
import { extractGitHubContext, generateAckMessage } from '../../router/ackMessageGenerator.js';
import type { GitHubJob } from '../../router/queue.js';
import { scheduleCoalescedJob } from '../../router/queue.js';
import { captureException } from '../../sentry.js';
import type { CascadeConfig, ProjectConfig, TriggerContext } from '../../types/index.js';
import { logger, startWatchdog } from '../../utils/index.js';
import type { TriggerRegistry } from '../registry.js';
import { withAgentTypeConcurrency } from '../shared/concurrency.js';
import { withPMScope } from '../shared/credential-scope.js';
import { postPMAckComment } from '../shared/pm-ack.js';
import { resolveTriggerResult } from '../shared/trigger-resolution.js';
import { runAgentWithCredentials } from '../shared/webhook-execution.js';
import type { TriggerResult } from '../types.js';
import { postAcknowledgmentComment, updateInitialCommentWithError } from './ack-comments.js';
import { GitHubWebhookIntegration } from './integration.js';

const integration = new GitHubWebhookIntegration();

async function getPersonaTokenWithFallback(
	projectId: string,
	agentType: string | undefined,
): Promise<string> {
	try {
		return await getPersonaToken(projectId, agentType ?? 'implementation');
	} catch {
		return getPersonaToken(projectId, 'implementation').catch(() => '');
	}
}

function requireProjectId(project: ProjectConfig): string {
	if (!project.id) {
		throw new Error('Project id is required for GitHub webhook processing');
	}

	return project.id;
}

async function maybePostPmAckComment(
	result: TriggerResult,
	payload: unknown,
	eventType: string,
	project: ProjectConfig,
	workItemId: string,
): Promise<void> {
	const context = extractGitHubContext(payload, eventType);
	const projectId = requireProjectId(project);
	const message = await generateAckMessage(
		result.agentType ?? 'implementation',
		context,
		projectId,
	);
	const pmType = project.pm?.type;

	const commentId = await postPMAckComment(
		projectId,
		workItemId,
		pmType,
		message,
		result.agentType ?? undefined,
	);

	if (commentId) {
		result.agentInput.ackCommentId = commentId;
		result.agentInput.ackMessage = message;
	}
}

/** Build a GitHub trigger context with persona identities for registry dispatch. */
async function buildTriggerContext(
	payload: unknown,
	project: ProjectConfig,
): Promise<TriggerContext> {
	const projectId = requireProjectId(project);
	const personaIdentities = await resolvePersonaIdentities(projectId);
	return { project, source: 'github', payload, personaIdentities };
}

/** Post ack comment on the PR using the agent-specific persona token. */
async function maybePostAckComment(
	result: TriggerResult,
	payload: unknown,
	eventType: string,
	project: ProjectConfig,
): Promise<void> {
	// PM-focused agents (e.g. backlog-manager) triggered from GitHub should have their
	// ack posted to the PM tool (Trello/JIRA card), not to the already-merged GitHub PR.
	if (result.agentType && (await isPMFocusedAgent(result.agentType))) {
		const workItemId = result.workItemId;
		if (!workItemId) {
			logger.warn('PM-focused agent has no workItemId for ack, skipping PM ack (worker-side)', {
				agentType: result.agentType,
			});
			return;
		}
		try {
			await maybePostPmAckComment(result, payload, eventType, project, workItemId);
		} catch (err) {
			logger.warn('PM ack comment failed for PM-focused agent (non-fatal)', {
				error: String(err),
				agentType: result.agentType,
			});
		}
		return;
	}

	const prCommentToken = await getPersonaTokenWithFallback(
		requireProjectId(project),
		result.agentType ?? undefined,
	);
	await withGitHubToken(prCommentToken, () =>
		postAcknowledgmentComment(result, payload, eventType, project),
	);
}

function resolveGitHubExecutionConfig(pmFocused: boolean) {
	if (!pmFocused) {
		return integration.resolveExecutionConfig();
	}

	return {
		skipPrepareForAgent: false,
		skipHandleFailure: false,
		logLabel: 'GitHub (PM-focused agent)',
	};
}

/** Run the agent with GitHub-specific (or PM-appropriate) execution config. */
async function runGitHubAgent(
	result: TriggerResult,
	project: ProjectConfig,
	config: CascadeConfig,
): Promise<void> {
	// PM-focused agents (e.g. backlog-manager) triggered from GitHub should use
	// PM-appropriate lifecycle config: no GitHub PR comment callbacks, allow PM lifecycle ops.
	const pmFocused = result.agentType ? await isPMFocusedAgent(result.agentType) : false;

	const agentType = result.agentType;

	const execute = async () => {
		// Only start the watchdog when the agent actually runs (after concurrency check passes).
		// Starting it before the check risks a spurious process.exit(1) if the container
		// is still alive after a concurrency-blocked job finishes.
		startWatchdog(project.watchdogTimeoutMs);

		// Establish PM credential + provider scope for agents with workItemId
		// (needed for PM lifecycle operations: labels, status moves, PR links)
		await withPMScope(project, () =>
			runAgentWithCredentials(
				integration,
				result,
				project,
				config,
				resolveGitHubExecutionConfig(pmFocused),
			),
		);
	};

	// Agent-type concurrency limit wraps the entire execution
	try {
		if (agentType) {
			await withAgentTypeConcurrency(
				project.id,
				agentType,
				execute,
				'GitHub agent',
				result.workItemId,
			);
		} else {
			await execute();
		}
	} catch (err) {
		logger.error('Failed to process GitHub webhook', { error: String(err) });
		if (!pmFocused) {
			// Update the PR comment with the error (outside credential scope, so requires token)
			const prCommentToken = await getPersonaTokenWithFallback(
				requireProjectId(project),
				result.agentType ?? undefined,
			);
			await withGitHubToken(prCommentToken, () =>
				updateInitialCommentWithError(result, { success: false, error: String(err) }),
			);
		}
	}
}

/**
 * Handles the case where a re-check job finds the trigger still returning
 * `deferredRecheck`.  Returns `true` when the caller should return immediately.
 *
 * - Mergeability re-check (`isRecheckJob=true`): one-shot — fire Sentry and
 *   give up.  A second deferred result means the mergeability flag is stuck
 *   and we should not queue-flood.
 * - Check-suite re-check (`isCheckSuiteRecheckJob=true`): safe rescheduling —
 *   the Actions API is still stale; schedule another delayed job via the same
 *   coalesceKey so the trigger re-evaluates when the API catches up.  Incoming
 *   `check_suite.completed` webhooks for the same SHA coalesce with the
 *   pending job, preventing queue flooding.
 */
async function handleRecheckResult(
	result: TriggerResult | null,
	isRecheckJob: boolean,
	isCheckSuiteRecheckJob: boolean,
	eventType: string,
	payload: unknown,
	projectIdentifier: string,
	projectId: string,
): Promise<boolean> {
	if (!result?.deferredRecheck) return false;

	if (isRecheckJob) {
		logger.warn('Mergeability still null after deferred re-check — giving up', { eventType });
		captureException(
			new Error('mergeability_recheck_exhausted: still null after deferred re-check'),
			{ tags: { source: 'mergeability_recheck_exhausted' }, extra: { eventType } },
		);
		return true;
	}

	if (isCheckSuiteRecheckJob) {
		const { coalesceKey, delayMs } = result.deferredRecheck;
		logger.info('Check-suite state still stale after deferred re-check — rescheduling', {
			eventType,
			coalesceKey,
			delayMs,
		});
		const recheckJob: GitHubJob = {
			type: 'github',
			source: 'github',
			payload,
			eventType,
			repoFullName: projectIdentifier,
			// Carry forward the project this run resolved (the stamped link-first
			// id on shared repositories, spec 024). Dropping it would force the
			// rescheduled re-check back onto the repo lookup — first match — which
			// need not own this PR, reopening the wrong-credentials bug for this
			// path alone.
			projectId,
			receivedAt: new Date().toISOString(),
			checkSuiteRecheckAttempt: 1,
		};
		try {
			await scheduleCoalescedJob(recheckJob, coalesceKey, delayMs);
		} catch (err) {
			captureException(err instanceof Error ? err : new Error(String(err)), {
				tags: { source: 'check_suite_recheck_reschedule_failure' },
				extra: { coalesceKey, eventType },
			});
			logger.error('Failed to reschedule check-suite recheck', {
				error: String(err),
				coalesceKey,
			});
		}
		return true;
	}

	return false;
}

export async function processGitHubWebhook(
	payload: unknown,
	eventType: string,
	registry: TriggerRegistry,
	ackCommentId?: number,
	ackMessage?: string,
	triggerResult?: TriggerResult,
	isRecheckJob?: boolean,
	isCheckSuiteRecheckJob?: boolean,
	/**
	 * The project the ROUTER resolved and stamped on the job (link-first on
	 * shared repositories, spec 024). When present the worker resolves the
	 * project by this id instead of re-deriving it from the repo — which takes
	 * the first match and, on a shared repository, need not own this PR. Absent
	 * only for jobs enqueued before jobs carried the id.
	 */
	projectId?: string,
): Promise<void> {
	logger.info('Processing GitHub webhook', {
		eventType,
		projectId,
		hasTriggerResult: !!triggerResult,
	});

	const event = integration.parseWebhookPayload(payload);
	if (!event) {
		logger.warn('GitHub webhook missing repository info');
		return;
	}

	// Prefer the project the ROUTER resolved (spec 024), mirroring the
	// Trello / JIRA / Linear worker cases. Re-deriving it from the repo takes the
	// first match, which on a shared repository need not own this PR: the agent
	// would then run under a different project's ProjectConfig (withPMScope,
	// engine/agent config, watchdog) than the one whose credentials built the
	// container, and a rescheduled check-suite re-check (handleRecheckResult
	// below) would carry that first-match project forward. The repo lookup
	// remains a fallback for jobs enqueued before jobs carried the id.
	const projectConfig = projectId
		? await loadProjectConfigById(projectId)
		: await integration.lookupProject(event.projectIdentifier);
	if (!projectConfig) {
		logger.warn('No project configured for repository', {
			repoFullName: event.projectIdentifier,
			projectId,
		});
		return;
	}
	const { project, config } = projectConfig;

	const ctx = triggerResult
		? ({ project, source: 'github', payload } satisfies TriggerContext)
		: await buildTriggerContext(payload, project);

	const result = await resolveTriggerResult(registry, ctx, triggerResult, {
		logLabel: 'GitHub webhook',
		dispatch: async (dispatchCtx) => {
			const githubToken = await getPersonaToken(requireProjectId(project), 'implementation');
			return withPMScope(project, () =>
				withGitHubToken(githubToken, () => registry.dispatch(dispatchCtx)),
			);
		},
	});

	if (!triggerResult) {
		const recheckHandled = await handleRecheckResult(
			result,
			!!isRecheckJob,
			!!isCheckSuiteRecheckJob,
			eventType,
			payload,
			event.projectIdentifier,
			requireProjectId(project),
		);
		if (recheckHandled) return;
	}

	if (!result) {
		logger.info('No trigger matched for GitHub webhook', {
			eventType,
			repoFullName: event.projectIdentifier,
		});
		return;
	}

	// Inject ack comment info from router into agent input
	if (ackCommentId) result.agentInput.ackCommentId = ackCommentId;
	if (ackMessage) result.agentInput.ackMessage = ackMessage;

	// Worker-side `waitForChecks` polling was removed in PR #1245 follow-up:
	// the success handler now defers (skips) on incomplete aggregate state, so
	// no TriggerResult ever reaches this point with the flag set, and no
	// worker bail-out can leave the dedup wedged.

	logger.info('GitHub trigger matched', {
		agentType: result.agentType || '(no agent)',
		prNumber: result.prNumber,
	});

	if (!result.agentType) {
		logger.info('Trigger completed without agent', { prNumber: result.prNumber });
		return;
	}

	// Post ack comment if the router hasn't already done so
	if (!ackCommentId) {
		await maybePostAckComment(result, payload, eventType, project);
	}

	await runGitHubAgent(result, project, config);
}
