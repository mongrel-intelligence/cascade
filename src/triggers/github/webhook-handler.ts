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
import { githubClient, withGitHubToken } from '../../github/client.js';
import { getPersonaToken, resolvePersonaIdentities } from '../../github/personas.js';
import { extractGitHubContext, generateAckMessage } from '../../router/ackMessageGenerator.js';
import type { CascadeConfig, ProjectConfig, TriggerContext } from '../../types/index.js';
import { logger, startWatchdog } from '../../utils/index.js';
import { parseRepoFullName } from '../../utils/repo.js';
import { safeOperation } from '../../utils/safeOperation.js';
import type { TriggerRegistry } from '../registry.js';
import { withAgentTypeConcurrency } from '../shared/concurrency.js';
import { withPMScope } from '../shared/credential-scope.js';
import { postPMAckComment } from '../shared/pm-ack.js';
import { runAgentWithCredentials } from '../shared/webhook-execution.js';
import type { TriggerResult } from '../types.js';
import { postAcknowledgmentComment, updateInitialCommentWithError } from './ack-comments.js';
import { pollWaitForChecks } from './check-polling.js';
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

/** Dispatch to trigger registry within PM credential + provider scope. */
async function dispatchTrigger(
	registry: TriggerRegistry,
	payload: unknown,
	project: ProjectConfig,
): Promise<TriggerResult | null> {
	const projectId = requireProjectId(project);
	const personaIdentities = await resolvePersonaIdentities(projectId);
	const githubToken = await getPersonaToken(projectId, 'implementation');
	const ctx: TriggerContext = { project, source: 'github', payload, personaIdentities };
	return withPMScope(project, () => withGitHubToken(githubToken, () => registry.dispatch(ctx)));
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
			await withAgentTypeConcurrency(project.id, agentType, execute, 'GitHub agent');
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

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: webhook orchestration with ack cleanup
export async function processGitHubWebhook(
	payload: unknown,
	eventType: string,
	registry: TriggerRegistry,
	ackCommentId?: number,
	ackMessage?: string,
	triggerResult?: TriggerResult,
): Promise<void> {
	logger.info('Processing GitHub webhook', { eventType, hasTriggerResult: !!triggerResult });

	const event = integration.parseWebhookPayload(payload);
	if (!event) {
		logger.warn('GitHub webhook missing repository info');
		return;
	}

	const projectConfig = await integration.lookupProject(event.projectIdentifier);
	if (!projectConfig) {
		logger.warn('No project configured for repository', {
			repoFullName: event.projectIdentifier,
		});
		return;
	}
	const { project, config } = projectConfig;

	// Resolve trigger result — use pre-resolved from router or dispatch via registry
	let result: TriggerResult | null;
	if (triggerResult) {
		logger.info('Using pre-resolved trigger result for GitHub webhook', {
			agentType: triggerResult.agentType,
		});
		result = triggerResult;
	} else {
		result = await dispatchTrigger(registry, payload, project);
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

	// Poll until all CI checks pass before starting agent (deferred from trigger)
	if (result.waitForChecks) {
		const githubToken = await getPersonaToken(project.id, 'implementation');
		try {
			const checksOk = await pollWaitForChecks(result, event.projectIdentifier, githubToken);
			if (!checksOk) {
				result.onBlocked?.();
				// Clean up orphaned ack comment so the PR doesn't show a misleading "Reviewing" message
				const ackId = result.agentInput.ackCommentId as number | undefined;
				if (ackId && event.projectIdentifier) {
					const { owner, repo } = parseRepoFullName(event.projectIdentifier);
					const deleteToken = await getPersonaToken(
						project.id,
						result.agentType ?? 'implementation',
					);
					await withGitHubToken(deleteToken, () =>
						safeOperation(() => githubClient.deletePRComment(owner, repo, ackId), {
							action: 'delete ack comment after check polling timeout',
							prNumber: result.prNumber,
						}),
					);
				}
				return;
			}
		} catch (err) {
			result.onBlocked?.();
			throw err;
		}
	}

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
