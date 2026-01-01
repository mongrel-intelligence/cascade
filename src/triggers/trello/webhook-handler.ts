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
	dequeueWebhook,
	enqueueWebhook,
	getQueueLength,
	isCurrentlyProcessing,
	logger,
	scheduleShutdownAfterJob,
	setProcessing,
	startWatchdog,
} from '../../utils/index.js';
import type { TriggerRegistry } from '../registry.js';
import type { TriggerResult } from '../types.js';
import { isTrelloWebhookPayload } from '../types.js';

async function safeAddLabel(cardId: string, labelId: string | undefined): Promise<void> {
	if (!labelId) return;
	try {
		await trelloClient.addLabelToCard(cardId, labelId);
	} catch (err) {
		logger.warn('Failed to add label', { error: String(err), labelId });
	}
}

async function safeRemoveLabel(cardId: string, labelId: string | undefined): Promise<void> {
	if (!labelId) return;
	try {
		await trelloClient.removeLabelFromCard(cardId, labelId);
	} catch {
		// Ignore - label might not be present
	}
}

async function safeAddComment(cardId: string, text: string): Promise<void> {
	try {
		await trelloClient.addComment(cardId, text);
	} catch (err) {
		logger.warn('Failed to add comment', { error: String(err) });
	}
}

async function safeMoveCard(cardId: string, listId: string | undefined): Promise<void> {
	if (!listId) return;
	try {
		await trelloClient.moveCardToList(cardId, listId);
	} catch (err) {
		logger.warn('Failed to move card', { error: String(err), listId });
	}
}

async function handleAgentSuccess(
	cardId: string,
	project: ProjectConfig,
	result: TriggerResult,
	agentResult: AgentResult,
): Promise<void> {
	await safeAddLabel(cardId, project.trello.labels.processed);

	// Move to in-review if implementation and PR was created
	if (result.agentType === 'implementation' && agentResult.prUrl) {
		await safeMoveCard(cardId, project.trello.lists.inReview);
		await safeAddComment(cardId, `PR created: ${agentResult.prUrl}`);
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

async function executeAgent(
	result: TriggerResult,
	project: ProjectConfig,
	config: CascadeConfig,
): Promise<void> {
	const { cardId } = result;

	if (cardId) {
		await safeAddLabel(cardId, project.trello.labels.processing);
		await safeRemoveLabel(cardId, project.trello.labels.readyToProcess);
	}

	const agentResult = await runAgent(result.agentType, {
		...result.agentInput,
		project,
		config,
	});

	// Upload zipped log file to card (if available)
	if (cardId && agentResult.logBuffer) {
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const logName = `${result.agentType}-${timestamp}.zip`;
		try {
			await trelloClient.addAttachmentFile(cardId, agentResult.logBuffer, logName);
			logger.info('Uploaded agent log to card', { cardId, logName });
		} catch (err) {
			logger.warn('Failed to upload agent log', { error: String(err) });
		}
	}

	// Update cost custom field (accumulate with existing)
	const costFieldId = project.trello.customFields?.cost;
	if (cardId && costFieldId && agentResult.cost !== undefined && agentResult.cost > 0) {
		try {
			const items = await trelloClient.getCardCustomFieldItems(cardId);
			const currentItem = items.find((i) => i.idCustomField === costFieldId);
			const currentCost = Number.parseFloat(currentItem?.value?.number ?? '0');
			const newTotal = Math.round((currentCost + agentResult.cost) * 10000) / 10000;
			await trelloClient.updateCardCustomFieldNumber(cardId, costFieldId, newTotal);
			logger.info('Updated card cost', {
				cardId,
				sessionCost: agentResult.cost,
				totalCost: newTotal,
			});
		} catch (err) {
			logger.warn('Failed to update cost field', { error: String(err) });
		}
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

	if (isCurrentlyProcessing()) {
		const queued = enqueueWebhook(payload);
		if (queued) {
			logger.info('Currently processing, webhook queued', { queueLength: getQueueLength() });
		} else {
			logger.warn('Queue full, webhook rejected', { queueLength: getQueueLength() });
		}
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

	logger.info('Trigger matched', { agentType: result.agentType, cardId: result.cardId });

	setProcessing(true);

	// Start watchdog - force kill if job takes too long (Fly.io only)
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
		setProcessing(false);
		processNextQueuedWebhook(config, registry);
	}
}
