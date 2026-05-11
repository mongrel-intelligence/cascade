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
	/**
	 * Cascade project id chosen by the router. Forwarded to
	 * `processPMWebhook` so the worker uses the router's selection instead
	 * of re-looking up by Linear teamId — which would re-introduce the
	 * `.find()` shadow when two cascade projects share one team.
	 */
	projectId?: string,
): Promise<void> {
	const integration = pmRegistry.get('linear');
	await processPMWebhook(integration, payload, registry, ackCommentId, triggerResult, projectId);
}
