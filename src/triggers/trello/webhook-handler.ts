/**
 * Trello webhook handler.
 *
 * Thin wrapper around the generic PM webhook processor.
 * Resolves the Trello integration from the registry and delegates.
 */

import { pmRegistry } from '../../pm/index.js';
import { processPMWebhook } from '../../pm/webhook-handler.js';
import type { TriggerRegistry } from '../registry.js';

export async function processTrelloWebhook(
	payload: unknown,
	registry: TriggerRegistry,
	ackCommentId?: string,
): Promise<void> {
	const integration = pmRegistry.get('trello');
	await processPMWebhook(integration, payload, registry, ackCommentId);
}
