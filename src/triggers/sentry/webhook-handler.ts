/**
 * Sentry webhook handler.
 *
 * Uses the pre-computed TriggerResult from the router when available,
 * falling back to dispatching through the trigger registry if not.
 * After resolving the trigger result, runs the matched agent via the
 * shared execution pipeline.
 *
 * Shared utilities used:
 * - Trigger resolution → ../shared/trigger-resolution.ts
 * - Agent-type concurrency → ../shared/concurrency.ts
 * - PM credential scope → ../shared/credential-scope.ts
 */

import type { TriggerResult } from '../../types/index.js';
import { startWatchdog } from '../../utils/lifecycle.js';
import { logger } from '../../utils/logging.js';
import type { TriggerRegistry } from '../registry.js';
import { runAgentExecutionPipeline } from '../shared/agent-execution.js';
import { withAgentTypeConcurrency } from '../shared/concurrency.js';
import { withPMScope } from '../shared/credential-scope.js';
import { resolveTriggerResult } from '../shared/trigger-resolution.js';

export async function processSentryWebhook(
	payload: unknown,
	projectId: string,
	registry: TriggerRegistry,
	triggerResult?: TriggerResult,
): Promise<void> {
	const { loadProjectConfigById } = await import('../../config/provider.js');

	const pc = await loadProjectConfigById(projectId);
	if (!pc) {
		logger.warn('processSentryWebhook: project not found, skipping', { projectId });
		return;
	}

	const ctx = {
		project: pc.project,
		source: 'sentry' as const,
		payload,
	};

	// Resolve trigger result — use pre-computed from router or dispatch via registry
	const result = await resolveTriggerResult(registry, ctx, triggerResult, 'processSentryWebhook');

	if (!result) {
		logger.info('processSentryWebhook: no trigger matched', { projectId });
		return;
	}

	if (!result.agentType) {
		logger.info('processSentryWebhook: trigger matched but no agent type, skipping', {
			projectId,
		});
		return;
	}

	logger.info('processSentryWebhook: running agent', {
		projectId,
		agentType: result.agentType,
	});

	startWatchdog(pc.project.watchdogTimeoutMs);

	await withAgentTypeConcurrency(
		pc.project.id,
		result.agentType,
		() =>
			withPMScope(pc.project, () =>
				runAgentExecutionPipeline(result, pc.project, pc.config, {
					logLabel: 'Sentry agent',
					skipPrepareForAgent: true,
					skipHandleFailure: true,
				}),
			),
		'processSentryWebhook',
	);
}
