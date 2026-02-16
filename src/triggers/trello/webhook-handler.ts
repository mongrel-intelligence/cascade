import { runAgent } from '../../agents/registry.js';
import {
	findProjectByBoardId,
	getAgentCredential,
	getProjectSecret,
	loadConfig,
} from '../../config/provider.js';
import { withGitHubToken } from '../../github/client.js';
import { trelloClient, withTrelloCredentials } from '../../trello/client.js';
import type {
	AgentResult,
	CascadeConfig,
	ProjectConfig,
	TriggerContext,
} from '../../types/index.js';
import {
	cancelFreshMachineTimer,
	clearCardActive,
	dequeueWebhook,
	enqueueWebhook,
	getQueueLength,
	isCardActive,
	isCurrentlyProcessing,
	logger,
	scheduleShutdownAfterJob,
	setCardActive,
	setProcessing,
	startWatchdog,
} from '../../utils/index.js';
import { injectLlmApiKeys } from '../../utils/llmEnv.js';
import { safeOperation, silentOperation } from '../../utils/safeOperation.js';
import type { TriggerRegistry } from '../registry.js';
import { handleAgentResultArtifacts } from '../shared/agent-result-handler.js';
import { checkBudgetExceeded } from '../shared/budget.js';
import { triggerDebugAnalysis } from '../shared/debug-runner.js';
import { shouldTriggerDebug } from '../shared/debug-trigger.js';
import type { TrelloWebhookPayload, TriggerResult } from '../types.js';
import { isTrelloWebhookPayload } from '../types.js';

// ============================================================================
// Safe Card Operations
// ============================================================================

async function safeAddLabel(cardId: string, labelId: string | undefined): Promise<void> {
	if (!labelId) return;
	await safeOperation(() => trelloClient.addLabelToCard(cardId, labelId), {
		action: 'add label',
		labelId,
	});
}

async function safeRemoveLabel(cardId: string, labelId: string | undefined): Promise<void> {
	if (!labelId) return;
	await silentOperation(() => trelloClient.removeLabelFromCard(cardId, labelId));
}

async function safeAddComment(cardId: string, text: string): Promise<void> {
	await safeOperation(() => trelloClient.addComment(cardId, text), { action: 'add comment' });
}

async function safeMoveCard(cardId: string, listId: string | undefined): Promise<void> {
	if (!listId) return;
	await safeOperation(() => trelloClient.moveCardToList(cardId, listId), {
		action: 'move card',
		listId,
	});
}

// ============================================================================
// Agent Result Handlers
// ============================================================================

async function handleAgentSuccess(
	cardId: string,
	project: ProjectConfig,
	result: TriggerResult,
	agentResult: AgentResult,
): Promise<void> {
	await safeAddLabel(cardId, project.trello.labels.processed);

	// Move to in-review if implementation completed successfully
	if (result.agentType === 'implementation') {
		await safeMoveCard(cardId, project.trello.lists.inReview);
		if (agentResult.prUrl) {
			await safeAddComment(cardId, `PR created: ${agentResult.prUrl}`);
		}
	}
}

async function handleAgentFailure(
	cardId: string,
	project: ProjectConfig,
	agentResult: AgentResult,
): Promise<void> {
	await safeAddLabel(cardId, project.trello.labels.error);
	if (agentResult.error) {
		await safeAddComment(cardId, `❌ Agent failed: ${agentResult.error}`);
	}
}

// ============================================================================
// Agent Execution
// ============================================================================

async function executeAgent(
	result: TriggerResult,
	project: ProjectConfig,
	config: CascadeConfig,
): Promise<void> {
	// Resolve per-project credentials up front — all Trello/GitHub API calls
	// in this function (labels, comments, card moves, budget checks, agent run)
	// require scoped credentials.
	const trelloApiKey = await getProjectSecret(project.id, 'TRELLO_API_KEY');
	const trelloToken = await getProjectSecret(project.id, 'TRELLO_TOKEN');
	const githubToken = await getProjectSecret(project.id, 'GITHUB_TOKEN');

	// Check for agent-scoped credential overrides
	const agentGitHubToken = await getAgentCredential(project.id, result.agentType, 'GITHUB_TOKEN');
	const effectiveGithubToken = agentGitHubToken || githubToken;

	// Inject LLM API keys into process.env for llmist backend
	const restoreLlmEnv = await injectLlmApiKeys(project.id);

	try {
		await withTrelloCredentials({ apiKey: trelloApiKey, token: trelloToken }, () =>
			withGitHubToken(effectiveGithubToken, () => executeAgentWithCreds(result, project, config)),
		);
	} finally {
		restoreLlmEnv();
	}
}

async function checkPreFlightBudget(
	cardId: string,
	project: ProjectConfig,
	config: CascadeConfig,
): Promise<{ blocked: boolean; remainingBudgetUsd?: number }> {
	const budgetCheck = await checkBudgetExceeded(cardId, project, config);
	if (budgetCheck?.exceeded) {
		logger.warn('Card budget exceeded, agent not started', {
			cardId,
			currentCost: budgetCheck.currentCost,
			budget: budgetCheck.budget,
		});
		await safeRemoveLabel(cardId, project.trello.labels.processing);
		await safeAddLabel(cardId, project.trello.labels.error);
		await safeAddComment(
			cardId,
			`⛔ Budget exceeded: card cost $${budgetCheck.currentCost.toFixed(2)} >= limit $${budgetCheck.budget.toFixed(2)}. Agent not started.`,
		);
		return { blocked: true };
	}
	return { blocked: false, remainingBudgetUsd: budgetCheck?.remaining };
}

async function prepareCardForAgent(
	cardId: string,
	project: ProjectConfig,
	agentType: string,
): Promise<void> {
	setCardActive(cardId);
	await safeAddLabel(cardId, project.trello.labels.processing);
	await safeRemoveLabel(cardId, project.trello.labels.readyToProcess);
	await safeRemoveLabel(cardId, project.trello.labels.processed);

	if (agentType === 'implementation') {
		await safeMoveCard(cardId, project.trello.lists.inProgress);
	}
}

async function checkPostFlightBudget(
	cardId: string,
	project: ProjectConfig,
	config: CascadeConfig,
): Promise<void> {
	const postBudgetCheck = await checkBudgetExceeded(cardId, project, config);
	if (postBudgetCheck?.exceeded) {
		await safeAddLabel(cardId, project.trello.labels.error);
		await safeAddComment(
			cardId,
			`⚠️ Budget limit reached: card cost $${postBudgetCheck.currentCost.toFixed(2)} >= limit $${postBudgetCheck.budget.toFixed(2)}. Further agent runs will be blocked.`,
		);
	}
}

async function tryAutoDebug(
	agentResult: AgentResult,
	project: ProjectConfig,
	config: CascadeConfig,
): Promise<void> {
	if (!agentResult.runId) return;
	const debugTarget = await shouldTriggerDebug(agentResult.runId);
	if (debugTarget) {
		triggerDebugAnalysis(debugTarget.runId, project, config, debugTarget.cardId).catch((err) =>
			logger.error('Auto-debug failed', { error: String(err) }),
		);
	}
}

async function executeAgentWithCreds(
	result: TriggerResult,
	project: ProjectConfig,
	config: CascadeConfig,
): Promise<void> {
	const { cardId } = result;

	let remainingBudgetUsd: number | undefined;
	if (cardId) {
		const budget = await checkPreFlightBudget(cardId, project, config);
		if (budget.blocked) return;
		remainingBudgetUsd = budget.remainingBudgetUsd;
	}

	if (cardId) {
		await prepareCardForAgent(cardId, project, result.agentType);
	}

	const agentResult = await runAgent(result.agentType, {
		...result.agentInput,
		remainingBudgetUsd,
		project,
		config,
	});

	if (cardId) {
		await handleAgentResultArtifacts(cardId, result.agentType, agentResult, project);
		await checkPostFlightBudget(cardId, project, config);
		await safeRemoveLabel(cardId, project.trello.labels.processing);

		if (agentResult.success) {
			await handleAgentSuccess(cardId, project, result, agentResult);
		} else {
			await handleAgentFailure(cardId, project, agentResult);
		}
	}

	logger.info('Agent completed', {
		agentType: result.agentType,
		success: agentResult.success,
		runId: agentResult.runId,
	});

	await tryAutoDebug(agentResult, project, config);
}

// ============================================================================
// Webhook Processing
// ============================================================================

function processNextQueuedWebhook(config: CascadeConfig, registry: TriggerRegistry): void {
	const next = dequeueWebhook();
	if (next) {
		logger.info('Processing queued webhook', { queueLength: getQueueLength() });
		setImmediate(() => {
			processTrelloWebhook(next.payload, registry).catch((err) => {
				logger.error('Failed to process queued webhook', { error: String(err) });
			});
		});
	} else if (process.env.FLY_APP_NAME) {
		scheduleShutdownAfterJob(config.defaults.postJobGracePeriodMs);
	}
}

function tryQueueWebhook(payload: TrelloWebhookPayload): boolean {
	if (!isCurrentlyProcessing()) return false;

	const queued = enqueueWebhook(payload);
	if (queued) {
		logger.info('Currently processing, webhook queued', { queueLength: getQueueLength() });
	} else {
		logger.warn('Queue full, webhook rejected', { queueLength: getQueueLength() });
	}
	return true;
}

export async function processTrelloWebhook(
	payload: unknown,
	registry: TriggerRegistry,
): Promise<void> {
	logger.info('Processing Trello webhook');

	if (!isTrelloWebhookPayload(payload)) {
		logger.warn('Invalid Trello webhook payload', {
			payload: JSON.stringify(payload).slice(0, 200),
		});
		return;
	}

	if (tryQueueWebhook(payload)) {
		return;
	}

	const boardId = payload.model.id;
	const actionType = payload.action?.type;
	logger.info('Webhook details', { boardId, actionType });

	const config = await loadConfig();

	const project = await findProjectByBoardId(boardId);
	if (!project) {
		logger.warn('No project configured for board', { boardId });
		return;
	}

	// Establish Trello credential scope for all downstream operations
	// (trigger dispatch, label/comment updates, agent execution)
	const trelloApiKey = await getProjectSecret(project.id, 'TRELLO_API_KEY');
	const trelloToken = await getProjectSecret(project.id, 'TRELLO_TOKEN');

	await withTrelloCredentials({ apiKey: trelloApiKey, token: trelloToken }, async () => {
		const ctx: TriggerContext = { project, source: 'trello', payload };
		const result = await registry.dispatch(ctx);
		if (!result) {
			logger.info('No trigger matched for webhook', { actionType });
			return;
		}

		if (result.cardId && isCardActive(result.cardId)) {
			logger.info('Card already being processed, skipping', { cardId: result.cardId });
			return;
		}

		logger.info('Trigger matched', { agentType: result.agentType, cardId: result.cardId });
		cancelFreshMachineTimer();
		setProcessing(true);

		if (process.env.FLY_APP_NAME) {
			startWatchdog(config.defaults.watchdogTimeoutMs);
		}

		try {
			await executeAgent(result, project, config);
		} catch (err) {
			logger.error('Failed to process webhook', { error: String(err) });
			if (result.cardId) {
				await safeAddLabel(result.cardId, project.trello.labels.error);
				await safeAddComment(result.cardId, `❌ Error: ${String(err)}`);
			}
		} finally {
			if (result?.cardId) {
				clearCardActive(result.cardId);
			}
			setProcessing(false);
			processNextQueuedWebhook(config, registry);
		}
	});
}
