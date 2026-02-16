import { findProjectByBoardId, getProjectSecret, loadConfig } from '../../config/provider.js';
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
import type { TriggerRegistry } from '../registry.js';
import { executeAgentPipeline } from '../shared/agent-pipeline.js';
import { withProjectCredentials } from '../shared/credential-scope.js';
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
	const cardId = result.cardId ?? result.workItemId;
	const pmProvider = createPMProvider(project);
	const pmConfig = resolveProjectPMConfig(project);
	const lifecycle = new PMLifecycleManager(pmProvider, pmConfig);

	if (cardId) {
		setCardActive(cardId);
	}

	await withProjectCredentials(project, result.agentType, () =>
		executeAgentPipeline({
			agentType: result.agentType,
			agentInput: result.agentInput,
			workItemId: cardId,
			project,
			config,
			lifecycle,
		}),
	);
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

async function handleMatchedTrigger(
	registry: TriggerRegistry,
	payload: TrelloWebhookPayload,
	actionType: string | undefined,
	project: ProjectConfig,
	config: CascadeConfig,
	pmProvider: ReturnType<typeof createPMProvider>,
): Promise<void> {
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
		withPMProvider(pmProvider, () =>
			handleMatchedTrigger(registry, payload, actionType, project, config, pmProvider),
		),
	);
}
