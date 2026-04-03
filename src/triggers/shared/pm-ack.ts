/**
 * Shared PM acknowledgment posting utility for webhook handlers.
 *
 * Centralises the logic for posting acknowledgment comments to PM tools
 * (Trello/JIRA) for PM-focused agents triggered from GitHub or other
 * non-PM sources.
 *
 * Used by:
 * - Worker-side: `triggers/github/webhook-handler.ts` (maybePostPmAckComment)
 *
 * Note: `router/adapters/github.ts` has its own local `postPMAck` function
 * and does not use this shared utility.
 */

import { postJiraAck, postTrelloAck } from '../../router/acknowledgments.js';
import { logger } from '../../utils/logging.js';

/**
 * Post a PM acknowledgment comment to Trello or JIRA.
 *
 * Returns the comment ID if successfully posted, or null if the PM type
 * is not supported or posting failed.
 *
 * @param projectId  The project ID for credential resolution.
 * @param workItemId The work item ID to post the comment on (card ID / issue key).
 * @param pmType     The PM provider type ('trello' or 'jira').
 * @param message    The acknowledgment message to post.
 * @param agentType  Used only for warning log context when pmType is unknown.
 */
export async function postPMAckComment(
	projectId: string,
	workItemId: string,
	pmType: string | undefined,
	message: string,
	agentType?: string,
): Promise<string | null> {
	if (pmType === 'trello') {
		return postTrelloAck(projectId, workItemId, message);
	}

	if (pmType === 'jira') {
		return postJiraAck(projectId, workItemId, message);
	}

	logger.warn('Unknown PM type for PM-focused agent ack, skipping', {
		agentType,
		pmType,
	});
	return null;
}
