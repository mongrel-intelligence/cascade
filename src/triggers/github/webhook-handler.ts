/**
 * GitHub webhook handler.
 *
 * Thin orchestrator that delegates to focused modules:
 * - Ack comment management → ./ack-comments.ts
 * - CI check polling → ./check-polling.ts
 * - Credential scoping + agent execution → ../shared/webhook-execution.ts
 * - GitHub-specific AgentExecutionConfig → ./integration.ts
 */

import { withGitHubToken } from '../../github/client.js';
import { getPersonaToken, resolvePersonaIdentities } from '../../github/personas.js';
import { withPMCredentials, withPMProvider } from '../../pm/context.js';
import { createPMProvider, pmRegistry } from '../../pm/index.js';
import type { ProjectConfig, TriggerContext } from '../../types/index.js';
import {
	clearCardActive,
	enqueueWebhook,
	getQueueLength,
	isCardActive,
	isCurrentlyProcessing,
	logger,
	setCardActive,
	setProcessing,
	startWatchdog,
} from '../../utils/index.js';
import type { TriggerRegistry } from '../registry.js';
import { runAgentWithCredentials } from '../shared/webhook-execution.js';
import { processNextQueuedWebhook } from '../shared/webhook-queue.js';
import type { TriggerResult } from '../types.js';
import { postAcknowledgmentComment } from './ack-comments.js';
import { pollWaitForChecks } from './check-polling.js';
import { GitHubWebhookIntegration } from './integration.js';

const integration = new GitHubWebhookIntegration();

function processNextQueuedGitHubWebhook(registry: TriggerRegistry): void {
	processNextQueuedWebhook(
		(payload, eventType, ackCommentId, ackMsg) =>
			processGitHubWebhook(
				payload,
				eventType ?? 'pull_request_review_comment',
				registry,
				ackCommentId as number | undefined,
				ackMsg,
			),
		'GitHub',
		(entry) => entry.eventType ?? 'pull_request_review_comment',
	);
}

/** Enqueue the webhook if another job is currently processing. Returns true if enqueued. */
function tryEnqueueIfBusy(
	payload: unknown,
	eventType: string,
	ackCommentId?: number,
	ackMessage?: string,
): boolean {
	if (!isCurrentlyProcessing()) return false;
	const queued = enqueueWebhook(payload, eventType, ackCommentId, ackMessage);
	if (queued) {
		logger.info('Currently processing, GitHub webhook queued', {
			queueLength: getQueueLength(),
			eventType,
		});
	} else {
		logger.warn('Queue full, GitHub webhook rejected', { queueLength: getQueueLength() });
	}
	return true;
}

/** Dispatch to trigger registry within PM credential + provider scope. */
async function dispatchTrigger(
	registry: TriggerRegistry,
	payload: unknown,
	project: ProjectConfig,
): Promise<TriggerResult | null> {
	const personaIdentities = await resolvePersonaIdentities(project.id);
	const ctx: TriggerContext = { project, source: 'github', payload, personaIdentities };
	const pmProvider = createPMProvider(project);
	return withPMCredentials(
		project.id,
		project.pm?.type,
		(t) => pmRegistry.getOrNull(t),
		() => withPMProvider(pmProvider, () => registry.dispatch(ctx)),
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

/** Run the agent with GitHub-specific execution config, managing processing flags. */
async function runGitHubAgent(
	result: TriggerResult,
	project: ProjectConfig,
	config: { defaults: { watchdogTimeoutMs: number } },
	registry: TriggerRegistry,
): Promise<void> {
	const workItemId = result.workItemId;
	if (workItemId && isCardActive(workItemId)) {
		logger.info('Work item already being processed, skipping', { workItemId });
		return;
	}

	setProcessing(true);
	startWatchdog(config.defaults.watchdogTimeoutMs);

	try {
		if (workItemId) setCardActive(workItemId);
		await runAgentWithCredentials(
			integration,
			result,
			project,
			config as import('../../types/index.js').CascadeConfig,
			integration.resolveExecutionConfig(),
		);
	} catch (err) {
		logger.error('Failed to process GitHub webhook', { error: String(err) });
	} finally {
		if (workItemId) clearCardActive(workItemId);
		setProcessing(false);
		processNextQueuedGitHubWebhook(registry);
	}
}

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

	if (tryEnqueueIfBusy(payload, eventType, ackCommentId, ackMessage)) return;

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
		if (!checksOk) return;
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

	await runGitHubAgent(result, project, config, registry);
}
