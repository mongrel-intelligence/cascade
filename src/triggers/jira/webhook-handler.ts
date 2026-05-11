/**
 * JIRA webhook handler.
 *
 * Thin wrapper around the generic PM webhook processor.
 * Resolves the JIRA integration from the registry and delegates.
 */

import { pmRegistry } from '../../pm/index.js';
import { processPMWebhook } from '../../pm/webhook-handler.js';
import type { TriggerResult } from '../../types/index.js';
import type { TriggerRegistry } from '../registry.js';

export async function processJiraWebhook(
	payload: unknown,
	registry: TriggerRegistry,
	ackCommentId?: string,
	triggerResult?: TriggerResult,
	/**
	 * Cascade project id chosen by the router. Forwarded to
	 * `processPMWebhook` for symmetry with Linear (which needs this to
	 * avoid the `.find()` shadow on shared teamId). JIRA projectKey is
	 * naturally unique per cascade project so this is defensive rather
	 * than load-bearing.
	 */
	projectId?: string,
): Promise<void> {
	const integration = pmRegistry.get('jira');
	await processPMWebhook(integration, payload, registry, ackCommentId, triggerResult, projectId);
}
