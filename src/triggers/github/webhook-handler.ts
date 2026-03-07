/**
 * GitHub webhook handler.
 *
 * Thin orchestrator that delegates to focused modules:
 * - Ack comment management → ./ack-comments.ts
 * - CI check polling → ./check-polling.ts
 * - Credential scoping + agent execution → ../shared/webhook-execution.ts
 * - GitHub-specific AgentExecutionConfig → ./integration.ts
 */

import { githubClient, withGitHubToken } from '../../github/client.js';
import { getPersonaToken, resolvePersonaIdentities } from '../../github/personas.js';
import { withPMCredentials, withPMProvider } from '../../pm/context.js';
import { createPMProvider, pmRegistry } from '../../pm/index.js';
import {
	checkAgentTypeConcurrency,
	clearAgentTypeEnqueued,
	markAgentTypeEnqueued,
	markRecentlyDispatched,
} from '../../router/agent-type-lock.js';
import type { CascadeConfig, ProjectConfig, TriggerContext } from '../../types/index.js';
import { logger, startWatchdog } from '../../utils/index.js';
import { parseRepoFullName } from '../../utils/repo.js';
import { safeOperation } from '../../utils/safeOperation.js';
import type { TriggerRegistry } from '../registry.js';
import { runAgentWithCredentials } from '../shared/webhook-execution.js';
import type { TriggerResult } from '../types.js';
import { postAcknowledgmentComment, updateInitialCommentWithError } from './ack-comments.js';
import { pollWaitForChecks } from './check-polling.js';
import { GitHubWebhookIntegration } from './integration.js';

const integration = new GitHubWebhookIntegration();

/** Dispatch to trigger registry within PM credential + provider scope. */
async function dispatchTrigger(
	registry: TriggerRegistry,
	payload: unknown,
	project: ProjectConfig,
): Promise<TriggerResult | null> {
	const personaIdentities = await resolvePersonaIdentities(project.id);
	const githubToken = await getPersonaToken(project.id, 'implementation');
	const ctx: TriggerContext = { project, source: 'github', payload, personaIdentities };
	const pmProvider = createPMProvider(project);
	return withPMCredentials(
		project.id,
		project.pm?.type,
		(t) => pmRegistry.getOrNull(t),
		() =>
			withPMProvider(pmProvider, () => withGitHubToken(githubToken, () => registry.dispatch(ctx))),
	);
}

/** Post ack comment on the PR using the agent-specific persona token. */
async function maybePostAckComment(
	result: TriggerResult,
	payload: unknown,
	eventType: string,
	project: ProjectConfig,
): Promise<void> {
	let prCommentToken: string;
	try {
		prCommentToken = await getPersonaToken(project.id, result.agentType ?? 'implementation');
	} catch {
		prCommentToken = await getPersonaToken(project.id, 'implementation').catch(() => '');
	}
	await withGitHubToken(prCommentToken, () =>
		postAcknowledgmentComment(result, payload, eventType, project),
	);
}

/** Run the agent with GitHub-specific execution config. */
async function runGitHubAgent(
	result: TriggerResult,
	project: ProjectConfig,
	config: CascadeConfig,
): Promise<void> {
	// Agent-type concurrency limit
	let agentTypeMaxConcurrency: number | null = null;
	if (result.agentType) {
		const concurrencyCheck = await checkAgentTypeConcurrency(project.id, result.agentType);
		agentTypeMaxConcurrency = concurrencyCheck.maxConcurrency;
		if (concurrencyCheck.blocked) return;
		if (agentTypeMaxConcurrency !== null) {
			markRecentlyDispatched(project.id, result.agentType);
			markAgentTypeEnqueued(project.id, result.agentType);
		}
	}

	startWatchdog(config.defaults.watchdogTimeoutMs);

	try {
		// Establish PM credential + provider scope for agents with workItemId
		// (needed for PM lifecycle operations: labels, status moves, PR links)
		const pmProvider = createPMProvider(project);
		await withPMCredentials(
			project.id,
			project.pm?.type,
			(t) => pmRegistry.getOrNull(t),
			() =>
				withPMProvider(pmProvider, () =>
					runAgentWithCredentials(
						integration,
						result,
						project,
						config,
						integration.resolveExecutionConfig(),
					),
				),
		);
	} catch (err) {
		logger.error('Failed to process GitHub webhook', { error: String(err) });
		// Update the PR comment with the error (outside credential scope, so requires token)
		let prCommentToken: string;
		try {
			prCommentToken = await getPersonaToken(project.id, result.agentType ?? 'implementation');
		} catch {
			prCommentToken = await getPersonaToken(project.id, 'implementation').catch(() => '');
		}
		await withGitHubToken(prCommentToken, () =>
			updateInitialCommentWithError(result, { success: false, error: String(err) }),
		);
	} finally {
		if (result.agentType && agentTypeMaxConcurrency !== null) {
			clearAgentTypeEnqueued(project.id, result.agentType);
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
		const checksOk = await pollWaitForChecks(result, event.projectIdentifier, githubToken);
		if (!checksOk) {
			// Clean up orphaned ack comment so the PR doesn't show a misleading "Reviewing" message
			const ackId = result.agentInput.ackCommentId as number | undefined;
			if (ackId && event.projectIdentifier) {
				const { owner, repo } = parseRepoFullName(event.projectIdentifier);
				const deleteToken = await getPersonaToken(project.id, result.agentType ?? 'implementation');
				await withGitHubToken(deleteToken, () =>
					safeOperation(() => githubClient.deletePRComment(owner, repo, ackId), {
						action: 'delete ack comment after check polling timeout',
						prNumber: result.prNumber,
					}),
				);
			}
			return;
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
