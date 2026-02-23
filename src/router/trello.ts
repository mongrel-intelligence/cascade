/**
 * Trello webhook handler for the router (multi-container) deployment mode.
 *
 * Runs full trigger dispatch() to determine if a job should be queued.
 * Only posts ack comments and queues jobs when dispatch confirms a match.
 */

import { withTrelloCredentials } from '../trello/client.js';
import type { TriggerRegistry } from '../triggers/registry.js';
import type { TriggerContext, TriggerResult } from '../types/index.js';
import { logger } from '../utils/logging.js';
import { extractTrelloContext, generateAckMessage } from './ackMessageGenerator.js';
import { postTrelloAck, resolveTrelloBotMemberId } from './acknowledgments.js';
import { type RouterProjectConfig, loadProjectConfig } from './config.js';
import { resolveTrelloCredentials } from './platformClients.js';
import { type CascadeJob, addJob } from './queue.js';
import { sendAcknowledgeReaction } from './reactions.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Check if filename matches agent log pattern: {agent-type}-{timestamp}.zip
 * Examples: implementation-2026-01-02T16-30-24-339Z.zip, briefing-timeout-2026-01-02T12-34-56-789Z.zip
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
		project.trello.lists.briefing,
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

export interface TrelloWebhookResult {
	shouldProcess: boolean;
	project?: RouterProjectConfig;
	projectId?: string;
	actionType?: string;
	cardId?: string;
}

export async function parseTrelloWebhook(payload: unknown): Promise<TrelloWebhookResult> {
	if (!payload || typeof payload !== 'object') {
		return { shouldProcess: false };
	}

	const p = payload as Record<string, unknown>;
	const action = p.action as Record<string, unknown> | undefined;
	const model = p.model as Record<string, unknown> | undefined;

	if (!action || !model) {
		return { shouldProcess: false };
	}

	const boardId = model.id as string;
	const actionType = action.type as string;
	const data = action.data as Record<string, unknown> | undefined;

	const config = await loadProjectConfig();
	const project = config.projects.find((proj) => proj.trello?.boardId === boardId);
	if (!project) {
		return { shouldProcess: false };
	}

	// Extract card ID
	const card = data?.card as Record<string, unknown> | undefined;
	const cardId = card?.id as string | undefined;

	const shouldProcess =
		isCardInTriggerList(actionType, data, project) ||
		isReadyToProcessLabelAdded(actionType, data, project) ||
		isAgentLogAttachmentUploaded(actionType, data, project) ||
		actionType === 'commentCard';

	return { shouldProcess, project, projectId: project.id, actionType, cardId };
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

/**
 * Run authoritative dispatch and, if matched, post ack + queue job.
 */
export async function processTrelloWebhookEvent(
	project: RouterProjectConfig,
	cardId: string,
	actionType: string,
	payload: unknown,
	triggerRegistry: TriggerRegistry,
): Promise<void> {
	if (actionType === 'commentCard' && (await isSelfAuthoredTrelloComment(payload, project.id))) {
		logger.info('Ignoring self-authored Trello comment', { projectId: project.id });
		return;
	}

	// Fire-and-forget acknowledgment reaction — only for comment actions
	if (actionType === 'commentCard') {
		void sendAcknowledgeReaction('trello', project.id, payload).catch((err) =>
			logger.error('Trello reaction error', { error: String(err) }),
		);
	}

	// Run authoritative trigger dispatch with credentials in scope
	const config = await loadProjectConfig();
	const fullProject = config.fullProjects.find((fp) => fp.id === project.id);
	if (!fullProject) {
		logger.info('No full project config for Trello webhook, skipping', { projectId: project.id });
		return;
	}

	let result: TriggerResult | null = null;
	try {
		const trelloCreds = await resolveTrelloCredentials(project.id);
		if (!trelloCreds) {
			logger.warn('Missing Trello credentials, cannot dispatch triggers', {
				projectId: project.id,
			});
		} else {
			const ctx: TriggerContext = { project: fullProject, source: 'trello', payload };
			result = await withTrelloCredentials(trelloCreds, () => triggerRegistry.dispatch(ctx));
		}
	} catch (err) {
		logger.warn('Trello trigger dispatch failed (non-fatal)', {
			error: String(err),
			projectId: project.id,
		});
	}

	if (!result) {
		logger.info('No trigger matched for Trello event', { actionType, cardId });
		return;
	}

	logger.info('Trello trigger matched', {
		agentType: result.agentType,
		cardId,
		projectId: project.id,
	});

	// Post ack comment — we KNOW the trigger matched
	let ackCommentId: string | undefined;
	if (result.agentType) {
		try {
			const context = extractTrelloContext(payload);
			const message = await generateAckMessage(result.agentType, context, project.id);
			const commentId = await postTrelloAck(project.id, cardId, message);
			ackCommentId = commentId ?? undefined;
		} catch (err) {
			logger.warn('Trello ack comment failed (non-fatal)', { error: String(err), cardId });
		}
	}

	// Queue job with confirmed trigger result
	const job: CascadeJob = {
		type: 'trello',
		source: 'trello',
		payload,
		projectId: project.id,
		cardId,
		actionType: actionType || 'unknown',
		receivedAt: new Date().toISOString(),
		ackCommentId,
		triggerResult: result,
	};

	try {
		const jobId = await addJob(job);
		logger.info('Trello job queued', { jobId, actionType, ackCommentId });
	} catch (err) {
		logger.error('Failed to queue Trello job', { error: String(err), actionType, cardId });
		// Still return to caller — Trello gets 200 to avoid retries
	}
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Handle a POST /trello/webhook request.
 * Parses the payload, filters irrelevant events, dispatches triggers,
 * and queues a job only when a trigger confirms a match.
 */
export async function handleTrelloWebhook(
	payload: unknown,
	triggerRegistry: TriggerRegistry,
): Promise<{
	shouldProcess: boolean;
	project?: RouterProjectConfig;
	actionType?: string;
	cardId?: string;
}> {
	const { shouldProcess, project, actionType, cardId } = await parseTrelloWebhook(payload);

	if (shouldProcess && project && cardId) {
		await processTrelloWebhookEvent(
			project,
			cardId,
			actionType || 'unknown',
			payload,
			triggerRegistry,
		);
	} else {
		logger.debug('Ignoring Trello event', { actionType: actionType || 'unknown' });
	}

	return { shouldProcess, project, actionType, cardId };
}
