/**
 * Trello webhook helper functions for the router (multi-container) deployment mode.
 *
 * Contains pure/stateless helpers used by `TrelloRouterAdapter` to determine
 * whether a Trello webhook event is processable and whether it was self-authored.
 */

import { logger } from '../utils/logging.js';
import { resolveTrelloBotMemberId } from './acknowledgments.js';
import type { RouterProjectConfig } from './config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if filename matches agent log pattern: {agent-type}-{timestamp}.zip
 * Examples: implementation-2026-01-02T16-30-24-339Z.zip, splitting-timeout-2026-01-02T12-34-56-789Z.zip
 * The timestamp follows ISO 8601 format with colons replaced by hyphens: YYYY-MM-DDTHH-MM-SS-mmmZ
 */
export function isAgentLogFilename(filename: string): boolean {
	return /^.+-\d{4}-\d{2}-\d{2}T[\d-]+Z\.zip$/.test(filename);
}

export function isCardInTriggerList(
	actionType: string,
	data: Record<string, unknown> | undefined,
	project: RouterProjectConfig,
): boolean {
	if (!project.trello) return false;
	const triggerLists = [
		project.trello.lists.splitting,
		project.trello.lists.planning,
		project.trello.lists.todo,
	];

	// Card moved into a trigger list
	if (actionType === 'updateCard' && data?.listAfter) {
		const listAfter = data.listAfter as Record<string, unknown>;
		const listId = listAfter.id as string;
		if (triggerLists.includes(listId)) {
			logger.info('Card moved to trigger list', { listId });
			return true;
		}
	}

	// Card created directly in a trigger list
	if (actionType === 'createCard' && data?.list) {
		const list = data.list as Record<string, unknown>;
		const listId = list.id as string;
		if (triggerLists.includes(listId)) {
			logger.info('Card created in trigger list', { listId });
			return true;
		}
	}

	return false;
}

export function isReadyToProcessLabelAdded(
	actionType: string,
	data: Record<string, unknown> | undefined,
	project: RouterProjectConfig,
): boolean {
	if (actionType !== 'addLabelToCard' || !data?.label) return false;
	if (!project.trello) return false;

	const label = data.label as Record<string, unknown>;
	const labelId = label.id as string;

	if (labelId === project.trello.labels.readyToProcess) {
		logger.info('Ready-to-process label added', { labelId });
		return true;
	}
	return false;
}

export function isAgentLogAttachmentUploaded(
	actionType: string,
	data: Record<string, unknown> | undefined,
	project: RouterProjectConfig,
): boolean {
	if (actionType !== 'addAttachmentToCard' || !data?.attachment) return false;
	if (!project.trello?.lists.debug) return false;

	const attachment = data.attachment as Record<string, unknown>;
	const name = attachment.name as string | undefined;

	if (name && isAgentLogFilename(name) && !name.startsWith('debug-')) {
		logger.info('Agent log attachment uploaded', { name });
		return true;
	}
	return false;
}

export async function isSelfAuthoredTrelloComment(
	payload: unknown,
	projectId: string,
): Promise<boolean> {
	const action = (payload as Record<string, unknown>).action as Record<string, unknown> | undefined;
	const commentAuthorId = action?.idMemberCreator as string | undefined;
	if (!commentAuthorId) return false;
	try {
		const botId = await resolveTrelloBotMemberId(projectId);
		return !!botId && commentAuthorId === botId;
	} catch {
		return false; // Identity resolution failed — proceed normally
	}
}
