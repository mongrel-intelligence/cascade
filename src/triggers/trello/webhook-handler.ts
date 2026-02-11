import { runAgent } from '../../agents/registry.js';
import { findProjectByBoardId } from '../../config/projects.js';
import { trelloClient } from '../../trello/client.js';
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
import { safeOperation, silentOperation } from '../../utils/safeOperation.js';
import type { TriggerRegistry } from '../registry.js';
import { handleAgentResultArtifacts } from '../shared/agent-result-handler.js';
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
	const { cardId } = result;

	if (cardId) {
		setCardActive(cardId);
		await safeAddLabel(cardId, project.trello.labels.processing);
		await safeRemoveLabel(cardId, project.trello.labels.readyToProcess);
		// Remove PROCESSED label - card is starting fresh work, not yet processed by this agent
		await safeRemoveLabel(cardId, project.trello.labels.processed);

		// Move to IN PROGRESS when implementation starts
		if (result.agentType === 'implementation') {
			await safeMoveCard(cardId, project.trello.lists.inProgress);
		}
	}

	const agentResult = await runAgent(result.agentType, {
		...result.agentInput,
		project,
		config,
	});

	// Upload log and update cost on Trello card
	if (cardId) {
		await handleAgentResultArtifacts(cardId, result.agentType, agentResult, project);
	}

	if (cardId) {
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
	});
}

// ============================================================================
// Webhook Processing
// ============================================================================

function processNextQueuedWebhook(config: CascadeConfig, registry: TriggerRegistry): void {
	const next = dequeueWebhook();
	if (next) {
		logger.info('Processing queued webhook', { queueLength: getQueueLength() });
		setImmediate(() => {
			processTrelloWebhook(next.payload, config, registry).catch((err) => {
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

async function cleanupDebugDirectory(logDir: string | undefined): Promise<void> {
	if (!logDir || typeof logDir !== 'string' || !logDir.startsWith('/tmp/debug-')) {
		return;
	}

	logger.info('Cleaning up debug temp directory', { logDir });
	const { cleanupTempDir } = await import('../../utils/repo.js');
	await safeOperation(async () => await cleanupTempDir(logDir), {
		action: 'cleanup temp directory',
		logDir,
	});
}

export async function processTrelloWebhook(
	payload: unknown,
	config: CascadeConfig,
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

	const project = findProjectByBoardId(config, boardId);
	if (!project) {
		logger.warn('No project configured for board', { boardId });
		return;
	}

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
		await cleanupDebugDirectory(result?.agentInput?.logDir as string | undefined);
		setProcessing(false);
		processNextQueuedWebhook(config, registry);
	}
}
