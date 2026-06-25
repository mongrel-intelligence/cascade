/**
 * Generic PM webhook processor.
 *
 * Extracts the common webhook processing flow from the Trello and JIRA
 * webhook handlers into a single PM-agnostic function. Provider-specific
 * behavior (credential resolution, payload parsing, project lookup,
 * ack comment management) is delegated to the PMIntegration interface.
 */

import { loadProjectConfigById } from '../config/provider.js';
import { isPmPostingEnabled, resolveUpdateChannel } from '../config/updateChannel.js';
import type { TriggerRegistry } from '../triggers/registry.js';
import { withAgentTypeConcurrency } from '../triggers/shared/concurrency.js';
import { resolveTriggerResult } from '../triggers/shared/trigger-resolution.js';
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

async function resolvePMTriggerResult(
	integration: PMIntegration,
	registry: TriggerRegistry,
	payload: unknown,
	project: ProjectConfig,
	ackCommentId: string | undefined,
	preResolvedResult: TriggerResult | undefined,
): Promise<TriggerResult | null> {
	const ctx: TriggerContext = { project, source: integration.type as TriggerSource, payload };
	return resolveTriggerResult(registry, ctx, preResolvedResult, {
		logLabel: `${integration.type} webhook`,
		onNoMatch: async () => {
			if (!ackCommentId) return;
			await cleanupOrphanAck(integration, project.id, payload, ackCommentId);
		},
	});
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
	const result = await resolvePMTriggerResult(
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

	logger.info(`${integration.type} trigger matched`, {
		agentType: result.agentType,
		workItemId: result.workItemId,
	});

	const execute = async () => {
		startWatchdog(project.watchdogTimeoutMs);

		const pmConfig = resolveProjectPMConfig(project);
		// Gate the last-resort error comment on the agent's resolved update
		// channel, mirroring the gated inner lifecycle built in
		// `createAgentExecutionContext`. This is the only lifecycle constructed on
		// the operational-fault catch path (an unhandled exception escaping
		// `executeAgent`); without this flag a `none` / `scm-only` agent would
		// still post a `❌ Error:` comment to the PM card, the one place the
		// "disabled PM channel simply no-ops" invariant otherwise wouldn't hold.
		const pmPostingEnabled = result.agentType
			? isPmPostingEnabled(resolveUpdateChannel(project, result.agentType))
			: true;
		const lifecycle = new PMLifecycleManager(getPMProvider(), pmConfig, pmPostingEnabled);

		try {
			await executeAgent(integration, result, project, config);
		} catch (err) {
			logger.error(`Failed to process ${integration.type} webhook`, { error: String(err) });
			if (result.workItemId) {
				await lifecycle.handleError(result.workItemId, String(err));
			}
		}
	};

	if (result.agentType) {
		await withAgentTypeConcurrency(
			project.id,
			result.agentType,
			execute,
			`${integration.type} webhook`,
			result.workItemId,
		);
	} else {
		await execute();
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
	/**
	 * Optional cascade project id selected by the router. When set, looks
	 * up the project by id (the router's choice) instead of re-resolving
	 * by webhook identifier — which would re-introduce the `.find()`
	 * first-match shadow when multiple cascade projects share one Linear
	 * team. Closes the prod regression chain that started with #1332 and
	 * #1337 in the Linear router adapter — fixing only those left a
	 * matching shadow in the worker-side webhook handler.
	 *
	 * Trello / JIRA setups never had this active shadow (their
	 * discriminators are naturally unique per cascade project), but
	 * threading the id through here too is consistent and defensive
	 * against future multi-cascade-project-per-discriminator configs.
	 */
	preferredProjectId?: string,
): Promise<void> {
	logger.info(`Processing ${integration.type} webhook`, {
		hasTriggerResult: !!triggerResult,
		preferredProjectId,
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
		preferredProjectId,
	});

	const projectConfig = preferredProjectId
		? await loadProjectConfigById(preferredProjectId)
		: await integration.lookupProject(event.projectIdentifier);
	if (!projectConfig) {
		logger.warn(`No project configured for ${integration.type} identifier`, {
			identifier: event.projectIdentifier,
			preferredProjectId,
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
