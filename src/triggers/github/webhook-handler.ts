import { runAgent } from '../../agents/registry.js';
import { findProjectByRepo } from '../../config/projects.js';
import { githubClient } from '../../github/client.js';
import { trelloClient } from '../../trello/client.js';
import type { CascadeConfig, ProjectConfig, TriggerContext } from '../../types/index.js';
import {
	cancelFreshMachineTimer,
	dequeueWebhook,
	enqueueWebhook,
	getQueueLength,
	isCurrentlyProcessing,
	logger,
	scheduleShutdownAfterJob,
	setProcessing,
	startWatchdog,
} from '../../utils/index.js';
import { safeOperation } from '../../utils/safeOperation.js';
import type { TriggerRegistry } from '../registry.js';
import { handleAgentResultArtifacts } from '../shared/agent-result-handler.js';
import type { TriggerResult } from '../types.js';

async function executeGitHubAgent(
	result: TriggerResult,
	project: ProjectConfig,
	config: CascadeConfig,
): Promise<void> {
	const { cardId } = result;

	const agentResult = await runAgent(result.agentType, {
		...result.agentInput,
		project,
		config,
	});

	// Upload log and update cost on Trello card
	if (cardId) {
		await handleAgentResultArtifacts(cardId, result.agentType, agentResult, project);
	}

	// Move to in-review if implementation completed successfully
	if (cardId && result.agentType === 'implementation' && agentResult.success) {
		await safeOperation(() => trelloClient.moveCardToList(cardId, project.trello.lists.inReview), {
			action: 'move card to in-review',
			cardId,
		});
		if (agentResult.prUrl) {
			await safeOperation(
				() => trelloClient.addComment(cardId, `PR created: ${agentResult.prUrl}`),
				{
					action: 'add PR comment',
					cardId,
				},
			);
		}
	}

	logger.info('GitHub agent completed', {
		agentType: result.agentType,
		prNumber: result.prNumber,
		success: agentResult.success,
		cost: agentResult.cost,
	});
}

async function postAcknowledgmentComment(result: TriggerResult): Promise<void> {
	if (result.agentType !== 'respond-to-review' || !result.prNumber) {
		return;
	}
	const input = result.agentInput as { repoFullName?: string; acknowledgmentCommentId?: number };
	if (!input.repoFullName) {
		return;
	}
	const [owner, repo] = input.repoFullName.split('/');
	const prNumber = result.prNumber;
	const comment = await safeOperation(
		() => githubClient.createPRComment(owner, repo, prNumber, '👀 Checking this out...'),
		{ action: 'post acknowledgment comment', prNumber },
	);
	if (comment) {
		input.acknowledgmentCommentId = comment.id;
	}
}

function processNextQueuedGitHubWebhook(config: CascadeConfig, registry: TriggerRegistry): void {
	const next = dequeueWebhook();
	if (next) {
		const eventType = next.eventType || 'pull_request_review_comment'; // Fallback for backward compatibility
		logger.info('Processing queued GitHub webhook', {
			queueLength: getQueueLength(),
			eventType,
		});
		setImmediate(() => {
			processGitHubWebhook(next.payload, eventType, config, registry).catch((err) => {
				logger.error('Failed to process queued GitHub webhook', { error: String(err) });
			});
		});
	} else if (process.env.FLY_APP_NAME) {
		scheduleShutdownAfterJob(config.defaults.postJobGracePeriodMs);
	}
}

export async function processGitHubWebhook(
	payload: unknown,
	eventType: string,
	config: CascadeConfig,
	registry: TriggerRegistry,
): Promise<void> {
	logger.info('Processing GitHub webhook', { eventType });

	// Extract repo from payload
	const p = payload as Record<string, unknown>;
	const repository = p.repository as Record<string, unknown> | undefined;
	const repoFullName = repository?.full_name as string | undefined;

	if (!repoFullName) {
		logger.warn('GitHub webhook missing repository info');
		return;
	}

	if (isCurrentlyProcessing()) {
		const queued = enqueueWebhook(payload, eventType);
		if (queued) {
			logger.info('Currently processing, GitHub webhook queued', {
				queueLength: getQueueLength(),
				eventType,
			});
		} else {
			logger.warn('Queue full, GitHub webhook rejected', { queueLength: getQueueLength() });
		}
		return;
	}

	const project = findProjectByRepo(config, repoFullName);

	if (!project) {
		logger.warn('No project configured for repository', { repoFullName });
		return;
	}

	const ctx: TriggerContext = { project, source: 'github', payload };
	const result = await registry.dispatch(ctx);

	if (!result) {
		logger.info('No trigger matched for GitHub webhook', { eventType, repoFullName });
		return;
	}

	logger.info('GitHub trigger matched', {
		agentType: result.agentType || '(no agent)',
		prNumber: result.prNumber,
	});

	// Only run agent if agentType is specified
	// Some triggers (like PRReadyToMergeTrigger) perform actions directly without needing an agent
	if (result.agentType) {
		await postAcknowledgmentComment(result);
		cancelFreshMachineTimer();
		setProcessing(true);

		if (process.env.FLY_APP_NAME) {
			startWatchdog(config.defaults.watchdogTimeoutMs);
		}

		try {
			await executeGitHubAgent(result, project, config);
		} catch (err) {
			logger.error('Failed to process GitHub webhook', { error: String(err) });
		} finally {
			setProcessing(false);
			processNextQueuedGitHubWebhook(config, registry);
		}
	} else {
		// No agent needed, trigger already performed its action
		logger.info('Trigger completed without agent', { prNumber: result.prNumber });
	}
}
