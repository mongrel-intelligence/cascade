/**
 * Sentry webhook handler.
 *
 * Thin wrapper that creates a TriggerContext and dispatches
 * through the trigger registry (which has SentryIssueAlertTrigger
 * and SentryMetricAlertTrigger registered).
 */

import type { TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import type { TriggerRegistry } from '../registry.js';

export async function processSentryWebhook(
	payload: unknown,
	projectId: string,
	registry: TriggerRegistry,
	triggerResult?: TriggerResult,
): Promise<void> {
	if (triggerResult) {
		logger.debug('processSentryWebhook: using pre-computed trigger result', {
			projectId,
			agentType: triggerResult.agentType,
		});
	}

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

	await registry.dispatch(ctx);
}
