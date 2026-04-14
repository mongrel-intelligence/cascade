/**
 * Linear webhook handler.
 *
 * Thin wrapper around the generic PM webhook processor.
 * Resolves the Linear integration from the registry and delegates.
 */

import { pmRegistry } from '../../pm/index.js';
import { processPMWebhook } from '../../pm/webhook-handler.js';
import type { TriggerResult } from '../../types/index.js';
import type { TriggerRegistry } from '../registry.js';

export async function processLinearWebhook(
	payload: unknown,
	registry: TriggerRegistry,
	ackCommentId?: string,
	triggerResult?: TriggerResult,
): Promise<void> {
	const integration = pmRegistry.get('linear');
	await processPMWebhook(integration, payload, registry, ackCommentId, triggerResult);
}
