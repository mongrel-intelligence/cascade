/**
 * Generic PM webhook processor.
 *
 * Extracts the common webhook processing flow from the Trello and JIRA
 * webhook handlers into a single PM-agnostic function. Provider-specific
 * behavior (credential resolution, payload parsing, project lookup,
 * ack comment management) is delegated to the PMIntegration interface.
 */

import {
	checkAgentTypeConcurrency,
	clearAgentTypeEnqueued,
	markAgentTypeEnqueued,
	markRecentlyDispatched,
} from '../router/agent-type-lock.js';
import type { TriggerRegistry } from '../triggers/registry.js';
import { runAgentWithCredentials } from '../triggers/shared/webhook-execution.js';
import type { TriggerResult } from '../triggers/types.js';
import type {
	CascadeConfig,
	ProjectConfig,
	TriggerContext,
	TriggerSource,
} from '../types/index.js';
import { logger, startWatchdog } from '../utils/index.js';
import { getPMProvider, withPMProvider } from './context.js';
import type { PMIntegration } from './integration.js';
import { PMLifecycleManager, resolveProjectPMConfig } from './lifecycle.js';
import { pmRegistry } from './registry.js';

// ============================================================================
// Agent Execution
// ============================================================================

async function executeAgent(
	integration: PMIntegration,
	result: TriggerResult,
	project: ProjectConfig,
	config: CascadeConfig,
): Promise<void> {
	// Allow integrations to provide source-specific AgentExecutionConfig overrides
	// (e.g. GitHubWebhookIntegration skips PM lifecycle steps).
	const executionConfig = integration.resolveExecutionConfig?.();
	await runAgentWithCredentials(integration, result, project, config, executionConfig);
}

// ============================================================================
// Webhook Processing
// ============================================================================

async function cleanupOrphanAck(
	integration: PMIntegration,
	projectId: string,
	payload: unknown,
	ackCommentId: string,
): Promise<void> {
	const event = integration.parseWebhookPayload(payload);
	if (event?.workItemId) {
		logger.info('Cleaning up orphan ack comment', { ackCommentId });
		await integration.deleteAckComment(projectId, event.workItemId, ackCommentId).catch(() => {});
	}
}

async function resolveTriggerResult(
	integration: PMIntegration,
	registry: TriggerRegistry,
	payload: unknown,
	project: ProjectConfig,
	ackCommentId: string | undefined,
	preResolvedResult: TriggerResult | undefined,
): Promise<TriggerResult | null> {
	if (preResolvedResult) {
		logger.info(`Using pre-resolved trigger result for ${integration.type} webhook`, {
			agentType: preResolvedResult.agentType,
		});
		return preResolvedResult;
	}
	const ctx: TriggerContext = { project, source: integration.type as TriggerSource, payload };
	const result = await registry.dispatch(ctx);
	if (!result) {
		logger.info(`No trigger matched for ${integration.type} webhook`);
		if (ackCommentId) {
			await cleanupOrphanAck(integration, project.id, payload, ackCommentId);
		}
	}
	return result;
}

async function handleMatchedTrigger(
	integration: PMIntegration,
	registry: TriggerRegistry,
	payload: unknown,
	project: ProjectConfig,
	config: CascadeConfig,
	ackCommentId?: string,
	preResolvedResult?: TriggerResult,
): Promise<void> {
	const result = await resolveTriggerResult(
		integration,
		registry,
		payload,
		project,
		ackCommentId,
		preResolvedResult,
	);
	if (!result) return;

	// Pass ack comment ID into agent input for ProgressMonitor pre-seeding
	if (ackCommentId) {
		result.agentInput.ackCommentId = ackCommentId;
	}

	// Agent-type concurrency limit
	let agentTypeMaxConcurrency: number | null = null;
	if (result.agentType) {
		const concurrencyCheck = await checkAgentTypeConcurrency(project.id, result.agentType);
		agentTypeMaxConcurrency = concurrencyCheck.maxConcurrency;
		if (concurrencyCheck.blocked) return;
		if (agentTypeMaxConcurrency !== null) {
			markRecentlyDispatched(project.id, result.agentType);
			markAgentTypeEnqueued(project.id, result.agentType);
		}
	}

	logger.info(`${integration.type} trigger matched`, {
		agentType: result.agentType,
		workItemId: result.workItemId,
	});

	startWatchdog(project.watchdogTimeoutMs ?? config.defaults.watchdogTimeoutMs);

	const pmConfig = resolveProjectPMConfig(project);
	const lifecycle = new PMLifecycleManager(getPMProvider(), pmConfig);

	try {
		await executeAgent(integration, result, project, config);
	} catch (err) {
		logger.error(`Failed to process ${integration.type} webhook`, { error: String(err) });
		if (result.workItemId) {
			await lifecycle.handleError(result.workItemId, String(err));
		}
	} finally {
		if (result.agentType && agentTypeMaxConcurrency !== null) {
			clearAgentTypeEnqueued(project.id, result.agentType);
		}
	}
}

/**
 * Generic PM webhook processor.
 *
 * Validates the payload via the integration's `parseWebhookPayload()`,
 * looks up the project, establishes credential + PM provider scope,
 * dispatches to the trigger registry (or uses pre-resolved result),
 * and runs the matched agent.
 *
 * Used by both Trello and JIRA webhook handlers.
 */
export async function processPMWebhook(
	integration: PMIntegration,
	payload: unknown,
	registry: TriggerRegistry,
	ackCommentId?: string,
	triggerResult?: TriggerResult,
): Promise<void> {
	logger.info(`Processing ${integration.type} webhook`, {
		hasTriggerResult: !!triggerResult,
	});

	const event = integration.parseWebhookPayload(payload);
	if (!event) {
		logger.warn(`Invalid ${integration.type} webhook payload`, {
			payload: JSON.stringify(payload).slice(0, 200),
		});
		return;
	}

	logger.info(`${integration.type} webhook details`, {
		projectIdentifier: event.projectIdentifier,
		workItemId: event.workItemId,
		eventType: event.eventType,
	});

	const projectConfig = await integration.lookupProject(event.projectIdentifier);
	if (!projectConfig) {
		logger.warn(`No project configured for ${integration.type} identifier`, {
			identifier: event.projectIdentifier,
		});
		return;
	}
	const { project, config } = projectConfig;

	// Establish credential + PM provider scope for agent execution
	const pmProvider = pmRegistry.createProvider(project);
	await integration.withCredentials(project.id, () =>
		withPMProvider(pmProvider, () =>
			handleMatchedTrigger(
				integration,
				registry,
				payload,
				project,
				config,
				ackCommentId,
				triggerResult,
			),
		),
	);
}
