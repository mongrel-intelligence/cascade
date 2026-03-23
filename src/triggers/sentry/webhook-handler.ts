/**
 * Sentry webhook handler.
 *
 * Uses the pre-computed TriggerResult from the router when available,
 * falling back to dispatching through the trigger registry if not.
 * After resolving the trigger result, runs the matched agent via the
 * shared execution pipeline.
 */

import { withPMCredentials, withPMProvider } from '../../pm/context.js';
import { createPMProvider, pmRegistry } from '../../pm/index.js';
import type { TriggerResult } from '../../types/index.js';
import { startWatchdog } from '../../utils/lifecycle.js';
import { logger } from '../../utils/logging.js';
import type { TriggerRegistry } from '../registry.js';
import { runAgentExecutionPipeline } from '../shared/agent-execution.js';

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

	// Resolve trigger result — use pre-computed from router or dispatch via registry
	let result: TriggerResult | null;
	if (triggerResult) {
		logger.info('processSentryWebhook: using pre-computed trigger result', {
			projectId,
			agentType: triggerResult.agentType,
		});
		result = triggerResult;
	} else {
		const ctx = {
			project: pc.project,
			source: 'sentry' as const,
			payload,
		};
		result = await registry.dispatch(ctx);
	}

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

	const pmProvider = createPMProvider(pc.project);
	await withPMCredentials(
		pc.project.id,
		pc.project.pm?.type,
		(t) => pmRegistry.getOrNull(t),
		() =>
			withPMProvider(pmProvider, () =>
				runAgentExecutionPipeline(result, pc.project, pc.config, {
					logLabel: 'Sentry agent',
					skipPrepareForAgent: true,
					skipHandleFailure: true,
				}),
			),
	);
}
