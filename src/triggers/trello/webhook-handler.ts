import { getIntegrationCredential, loadProjectConfigByBoardId } from '../../config/provider.js';
import { withGitHubToken } from '../../github/client.js';
import { getPersonaToken } from '../../github/personas.js';
import {
	PMLifecycleManager,
	createPMProvider,
	resolveProjectPMConfig,
	withPMProvider,
} from '../../pm/index.js';
import { withTrelloCredentials } from '../../trello/client.js';
import type { CascadeConfig, ProjectConfig, TriggerContext } from '../../types/index.js';
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
import { injectLlmApiKeys } from '../../utils/llmEnv.js';
import type { TriggerRegistry } from '../registry.js';
import { runAgentExecutionPipeline } from '../shared/agent-execution.js';
import { processNextQueuedWebhook } from '../shared/webhook-queue.js';
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
	const trelloApiKey = await getIntegrationCredential(project.id, 'pm', 'api_key');
	const trelloToken = await getIntegrationCredential(project.id, 'pm', 'token');
	const githubToken = await getPersonaToken(project.id, result.agentType);

	const restoreLlmEnv = await injectLlmApiKeys(project.id);

	try {
		const pmProvider = createPMProvider(project);
		await withTrelloCredentials({ apiKey: trelloApiKey, token: trelloToken }, () =>
			withPMProvider(pmProvider, () =>
				withGitHubToken(githubToken, () =>
					runAgentExecutionPipeline(result, project, config, { logLabel: 'Agent' }),
				),
			),
		);
	} finally {
		restoreLlmEnv();
	}
}

// ============================================================================
// Webhook Processing
// ============================================================================

function processNextQueued(registry: TriggerRegistry): void {
	processNextQueuedWebhook(
		(payload, _eventType, ackCommentId) =>
			processTrelloWebhook(payload, registry, ackCommentId as string | undefined),
		'Trello',
	);
}

function tryQueueWebhook(payload: TrelloWebhookPayload, ackCommentId?: string): boolean {
	if (!isCurrentlyProcessing()) return false;

	const queued = enqueueWebhook(payload, undefined, ackCommentId);
	if (queued) {
		logger.info('Currently processing, webhook queued', { queueLength: getQueueLength() });
	} else {
		logger.warn('Queue full, webhook rejected', { queueLength: getQueueLength() });
	}
	return true;
}

async function cleanupOrphanTrelloAck(
	projectId: string,
	payload: TrelloWebhookPayload,
	ackCommentId: string,
): Promise<void> {
	const cardId = (payload.action?.data?.card as Record<string, unknown> | undefined)?.id as
		| string
		| undefined;
	if (cardId) {
		logger.info('Cleaning up orphan ack comment', { ackCommentId, cardId });
		const { deleteTrelloAck } = await import('../../router/acknowledgments.js');
		await deleteTrelloAck(projectId, cardId, ackCommentId).catch(() => {});
	}
}

async function handleMatchedTrigger(
	registry: TriggerRegistry,
	payload: TrelloWebhookPayload,
	actionType: string | undefined,
	project: ProjectConfig,
	config: CascadeConfig,
	pmProvider: ReturnType<typeof createPMProvider>,
	ackCommentId?: string,
): Promise<void> {
	const ctx: TriggerContext = { project, source: 'trello', payload };
	const result = await registry.dispatch(ctx);
	if (!result) {
		logger.info('No trigger matched for webhook', { actionType });
		if (ackCommentId) {
			await cleanupOrphanTrelloAck(project.id, payload, ackCommentId);
		}
		return;
	}

	// Pass ack comment ID into agent input for ProgressMonitor pre-seeding
	if (ackCommentId) {
		result.agentInput.ackCommentId = ackCommentId;
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
		if (cardId) {
			setCardActive(cardId);
		}
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
		processNextQueued(registry);
	}
}

export async function processTrelloWebhook(
	payload: unknown,
	registry: TriggerRegistry,
	ackCommentId?: string,
): Promise<void> {
	logger.info('Processing Trello webhook');

	if (!isTrelloWebhookPayload(payload)) {
		logger.warn('Invalid Trello webhook payload', {
			payload: JSON.stringify(payload).slice(0, 200),
		});
		return;
	}

	if (tryQueueWebhook(payload, ackCommentId)) {
		return;
	}

	const boardId = payload.model.id;
	const actionType = payload.action?.type;
	logger.info('Webhook details', { boardId, actionType });

	const projectConfig = await loadProjectConfigByBoardId(boardId);
	if (!projectConfig) {
		logger.warn('No project configured for board', { boardId });
		return;
	}
	const { project, config } = projectConfig;

	// Establish Trello credential + PM provider scope for all downstream operations
	const trelloApiKey = await getIntegrationCredential(project.id, 'pm', 'api_key');
	const trelloToken = await getIntegrationCredential(project.id, 'pm', 'token');
	const pmProvider = createPMProvider(project);

	await withTrelloCredentials({ apiKey: trelloApiKey, token: trelloToken }, () =>
		withPMProvider(pmProvider, () =>
			handleMatchedTrigger(
				registry,
				payload,
				actionType,
				project,
				config,
				pmProvider,
				ackCommentId,
			),
		),
	);
}
