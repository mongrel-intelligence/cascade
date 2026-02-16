import { runAgent } from '../../agents/registry.js';
import {
	findProjectByBoardId,
	getAgentCredential,
	getProjectSecret,
	loadConfig,
} from '../../config/provider.js';
import { withGitHubToken } from '../../github/client.js';
import {
	PMLifecycleManager,
	createPMProvider,
	resolveProjectPMConfig,
	withPMProvider,
} from '../../pm/index.js';
import { withTrelloCredentials } from '../../trello/client.js';
import type {
	AgentResult,
	CascadeConfig,
	ProjectConfig,
	TriggerContext,
} from '../../types/index.js';
import {
	clearCardActive,
	dequeueWebhook,
	enqueueWebhook,
	getQueueLength,
	isCardActive,
	isCurrentlyProcessing,
	logger,
	setCardActive,
	setProcessing,
	startWatchdog,
} from '../../utils/index.js';
import { injectLlmApiKeys } from '../../utils/llmEnv.js';
import type { TriggerRegistry } from '../registry.js';
import { handleAgentResultArtifacts } from '../shared/agent-result-handler.js';
import { checkBudgetExceeded } from '../shared/budget.js';
import { triggerDebugAnalysis } from '../shared/debug-runner.js';
import { shouldTriggerDebug } from '../shared/debug-trigger.js';
import type { TrelloWebhookPayload, TriggerResult } from '../types.js';
import { isTrelloWebhookPayload } from '../types.js';

// ============================================================================
// Agent Execution
// ============================================================================

async function executeAgent(
	result: TriggerResult,
	project: ProjectConfig,
	config: CascadeConfig,
): Promise<void> {
	const trelloApiKey = await getProjectSecret(project.id, 'TRELLO_API_KEY');
	const trelloToken = await getProjectSecret(project.id, 'TRELLO_TOKEN');
	const githubToken = await getProjectSecret(project.id, 'GITHUB_TOKEN');

	const agentGitHubToken = await getAgentCredential(project.id, result.agentType, 'GITHUB_TOKEN');
	const effectiveGithubToken = agentGitHubToken || githubToken;

	const restoreLlmEnv = await injectLlmApiKeys(project.id);

	try {
		const pmProvider = createPMProvider(project);
		await withTrelloCredentials({ apiKey: trelloApiKey, token: trelloToken }, () =>
			withPMProvider(pmProvider, () =>
				withGitHubToken(effectiveGithubToken, () => executeAgentWithCreds(result, project, config)),
			),
		);
	} finally {
		restoreLlmEnv();
	}
}

async function executeAgentWithCreds(
	result: TriggerResult,
	project: ProjectConfig,
	config: CascadeConfig,
): Promise<void> {
	const cardId = result.cardId ?? result.workItemId;
	const pmProvider = createPMProvider(project);
	const pmConfig = resolveProjectPMConfig(project);
	const lifecycle = new PMLifecycleManager(pmProvider, pmConfig);

	let remainingBudgetUsd: number | undefined;
	if (cardId) {
		const budgetCheck = await checkBudgetExceeded(cardId, project, config);
		if (budgetCheck?.exceeded) {
			logger.warn('Budget exceeded, agent not started', {
				cardId,
				currentCost: budgetCheck.currentCost,
				budget: budgetCheck.budget,
			});
			await lifecycle.handleBudgetExceeded(cardId, budgetCheck.currentCost, budgetCheck.budget);
			return;
		}
		remainingBudgetUsd = budgetCheck?.remaining;
	}

	if (cardId) {
		setCardActive(cardId);
		await lifecycle.prepareForAgent(cardId, result.agentType);
	}

	const agentResult = await runAgent(result.agentType, {
		...result.agentInput,
		remainingBudgetUsd,
		project,
		config,
	});

	if (cardId) {
		await handleAgentResultArtifacts(cardId, result.agentType, agentResult, project);

		const postBudgetCheck = await checkBudgetExceeded(cardId, project, config);
		if (postBudgetCheck?.exceeded) {
			await lifecycle.handleBudgetWarning(
				cardId,
				postBudgetCheck.currentCost,
				postBudgetCheck.budget,
			);
		}

		await lifecycle.cleanupProcessing(cardId);

		if (agentResult.success) {
			await lifecycle.handleSuccess(cardId, result.agentType, agentResult.prUrl);
		} else {
			await lifecycle.handleFailure(cardId, agentResult.error);
		}
	}

	logger.info('Agent completed', {
		agentType: result.agentType,
		success: agentResult.success,
		runId: agentResult.runId,
	});

	await tryAutoDebug(agentResult, project, config);
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

// ============================================================================
// Webhook Processing
// ============================================================================

function processNextQueuedWebhook(registry: TriggerRegistry): void {
	const next = dequeueWebhook();
	if (next) {
		logger.info('Processing queued webhook', { queueLength: getQueueLength() });
		setImmediate(() => {
			processTrelloWebhook(next.payload, registry).catch((err) => {
				logger.error('Failed to process queued webhook', { error: String(err) });
			});
		});
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

	// Establish Trello credential + PM provider scope for all downstream operations
	const trelloApiKey = await getProjectSecret(project.id, 'TRELLO_API_KEY');
	const trelloToken = await getProjectSecret(project.id, 'TRELLO_TOKEN');
	const pmProvider = createPMProvider(project);

	await withTrelloCredentials({ apiKey: trelloApiKey, token: trelloToken }, () =>
		withPMProvider(pmProvider, async () => {
			const ctx: TriggerContext = { project, source: 'trello', payload };
			const result = await registry.dispatch(ctx);
			if (!result) {
				logger.info('No trigger matched for webhook', { actionType });
				return;
			}

			const cardId = result.cardId ?? result.workItemId;
			if (cardId && isCardActive(cardId)) {
				logger.info('Card already being processed, skipping', { cardId });
				return;
			}

			logger.info('Trigger matched', { agentType: result.agentType, cardId });
			setProcessing(true);
			startWatchdog(config.defaults.watchdogTimeoutMs);

			const pmConfig = resolveProjectPMConfig(project);
			const lifecycle = new PMLifecycleManager(pmProvider, pmConfig);

			try {
				await executeAgent(result, project, config);
			} catch (err) {
				logger.error('Failed to process webhook', { error: String(err) });
				if (cardId) {
					await lifecycle.handleError(cardId, String(err));
				}
			} finally {
				if (cardId) {
					clearCardActive(cardId);
				}
				setProcessing(false);
				processNextQueuedWebhook(registry);
			}
		}),
	);
}
