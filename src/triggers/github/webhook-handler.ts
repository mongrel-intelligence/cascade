import { runAgent } from '../../agents/registry.js';
import { findProjectByRepo } from '../../config/projects.js';
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

	// Upload zipped log file to card (if available)
	if (cardId && agentResult.logBuffer) {
		const logBuffer = agentResult.logBuffer;
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const logName = `${result.agentType}-${timestamp}.zip`;
		await safeOperation(() => trelloClient.addAttachmentFile(cardId, logBuffer, logName), {
			action: 'upload agent log',
			cardId,
			logName,
		});
	}

	// Update cost custom field (accumulate with existing)
	const costFieldId = project.trello?.customFields?.cost;
	if (cardId && costFieldId && agentResult.cost !== undefined && agentResult.cost > 0) {
		const sessionCost = agentResult.cost;
		await safeOperation(
			async () => {
				const items = await trelloClient.getCardCustomFieldItems(cardId);
				const currentItem = items.find((i) => i.idCustomField === costFieldId);
				const currentCost = Number.parseFloat(currentItem?.value?.number ?? '0');
				const newTotal = Math.round((currentCost + sessionCost) * 10000) / 10000;
				await trelloClient.updateCardCustomFieldNumber(cardId, costFieldId, newTotal);
				logger.info('Updated card cost', {
					cardId,
					sessionCost,
					totalCost: newTotal,
				});
			},
			{ action: 'update cost field' },
		);
	}

	logger.info('GitHub agent completed', {
		agentType: result.agentType,
		prNumber: result.prNumber,
		success: agentResult.success,
		cost: agentResult.cost,
	});
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
