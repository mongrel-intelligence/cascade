import { runAgent } from '../../agents/registry.js';
import { findProjectByRepo, getProjectSecret, loadConfig } from '../../config/provider.js';
import { getSessionState } from '../../gadgets/sessionState.js';
import { githubClient, withGitHubToken } from '../../github/client.js';
import { trelloClient, withTrelloCredentials } from '../../trello/client.js';
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
import { checkBudgetExceeded } from '../shared/budget.js';
import type { TriggerResult } from '../types.js';

async function executeGitHubAgent(
	result: TriggerResult,
	project: ProjectConfig,
	config: CascadeConfig,
): Promise<void> {
	const { cardId } = result;

	// Pre-flight budget check
	let remainingBudgetUsd: number | undefined;
	if (cardId) {
		const budgetCheck = await checkBudgetExceeded(cardId, project, config);
		if (budgetCheck?.exceeded) {
			logger.warn('Card budget exceeded, GitHub agent not started', {
				cardId,
				currentCost: budgetCheck.currentCost,
				budget: budgetCheck.budget,
			});
			await safeOperation(() => trelloClient.addLabelToCard(cardId, project.trello.labels.error), {
				action: 'add error label',
			});
			await safeOperation(
				() =>
					trelloClient.addComment(
						cardId,
						`⛔ Budget exceeded: card cost $${budgetCheck.currentCost.toFixed(2)} >= limit $${budgetCheck.budget.toFixed(2)}. Agent not started.`,
					),
				{ action: 'add budget comment' },
			);
			return;
		}
		if (budgetCheck) {
			remainingBudgetUsd = budgetCheck.remaining;
		}
	}

	// Resolve per-project credentials and wrap agent execution
	const trelloApiKey = await getProjectSecret(project.id, 'TRELLO_API_KEY', 'TRELLO_API_KEY');
	const trelloToken = await getProjectSecret(project.id, 'TRELLO_TOKEN', 'TRELLO_TOKEN');
	const githubToken = await getProjectSecret(project.id, 'GITHUB_TOKEN', 'GITHUB_TOKEN');

	const agentResult = await withTrelloCredentials(
		{ apiKey: trelloApiKey, token: trelloToken },
		() =>
			withGitHubToken(githubToken, () =>
				runAgent(result.agentType, {
					...result.agentInput,
					remainingBudgetUsd,
					project,
					config,
				}),
			),
	);

	// Upload log and update cost on Trello card
	if (cardId) {
		await handleAgentResultArtifacts(cardId, result.agentType, agentResult, project);

		// Post-flight budget check
		const postBudgetCheck = await checkBudgetExceeded(cardId, project, config);
		if (postBudgetCheck?.exceeded) {
			await safeOperation(() => trelloClient.addLabelToCard(cardId, project.trello.labels.error), {
				action: 'add error label',
			});
			await safeOperation(
				() =>
					trelloClient.addComment(
						cardId,
						`⚠️ Budget limit reached: card cost $${postBudgetCheck.currentCost.toFixed(2)} >= limit $${postBudgetCheck.budget.toFixed(2)}. Further agent runs will be blocked.`,
					),
				{ action: 'add budget warning comment' },
			);
		}
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

	// Update initial PR comment on failure for GitHub-bound agents
	if (!agentResult.success && result.prNumber) {
		await updateInitialCommentWithError(result, agentResult);
	}

	logger.info('GitHub agent completed', {
		agentType: result.agentType,
		prNumber: result.prNumber,
		success: agentResult.success,
		cost: agentResult.cost,
	});
}

async function updateInitialCommentWithError(
	result: TriggerResult,
	agentResult: { success: boolean; error?: string },
): Promise<void> {
	const input = result.agentInput as { repoFullName?: string };
	if (!input.repoFullName || !result.prNumber) return;

	const [owner, repo] = input.repoFullName.split('/');
	if (!owner || !repo) return;

	const { initialCommentId } = getSessionState();
	if (!initialCommentId) return;

	const errorMessage = agentResult.error || 'Agent completed without making changes';
	const body = `⚠️ **${result.agentType} agent failed**\n\n${errorMessage}\n\n<sub>Manual intervention may be required.</sub>`;

	await safeOperation(() => githubClient.updatePRComment(owner, repo, initialCommentId, body), {
		action: 'update PR comment with error',
		prNumber: result.prNumber,
	});
}

async function postAcknowledgmentComment(result: TriggerResult): Promise<void> {
	if (
		(result.agentType !== 'respond-to-review' && result.agentType !== 'respond-to-pr-comment') ||
		!result.prNumber
	) {
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
		const eventType = next.eventType || 'pull_request_review_comment';
		logger.info('Processing queued GitHub webhook', {
			queueLength: getQueueLength(),
			eventType,
		});
		setImmediate(() => {
			processGitHubWebhook(next.payload, eventType, registry).catch((err) => {
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

	const config = await loadConfig();

	const project = await findProjectByRepo(repoFullName);

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
			await updateInitialCommentWithError(result, { success: false, error: String(err) });
		} finally {
			setProcessing(false);
			processNextQueuedGitHubWebhook(config, registry);
		}
	} else {
		// No agent needed, trigger already performed its action
		logger.info('Trigger completed without agent', { prNumber: result.prNumber });
	}
}
