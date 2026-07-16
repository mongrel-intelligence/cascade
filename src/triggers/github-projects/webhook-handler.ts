/**
 * GitHub Projects webhook handler.
 *
 * Thin wrapper around the generic PM webhook processor.
 * Resolves the GitHub Projects integration from the registry and delegates.
 */

import { pmRegistry } from '../../pm/index.js';
import { processPMWebhook } from '../../pm/webhook-handler.js';
import type { TriggerResult } from '../../types/index.js';
import type { TriggerRegistry } from '../registry.js';

export async function processGitHubProjectsWebhook(
	payload: unknown,
	registry: TriggerRegistry,
	ackCommentId?: string,
	triggerResult?: TriggerResult,
	projectId?: string,
): Promise<void> {
	const integration = pmRegistry.get('github-projects');
	await processPMWebhook(integration, payload, registry, ackCommentId, triggerResult, projectId);
}
