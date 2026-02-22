/**
 * Trello webhook handler for the router (multi-container) deployment mode.
 *
 * Handles webhook parsing, self-comment filtering, ack posting, and job queuing
 * for Trello webhook events.
 */

import type { TriggerRegistry } from '../triggers/registry.js';
import type { TriggerContext } from '../types/index.js';
import { extractTrelloContext, generateAckMessage } from './ackMessageGenerator.js';
import { postTrelloAck, resolveTrelloBotMemberId } from './acknowledgments.js';
import { type RouterProjectConfig, loadProjectConfig } from './config.js';
import { type CascadeJob, addJob } from './queue.js';
import { sendAcknowledgeReaction } from './reactions.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Check if filename matches agent log pattern: {agent-type}-{timestamp}.zip
 * Examples: implementation-2026-01-02T16-30-24-339Z.zip, briefing-timeout-2026-01-02T12-34-56-789Z.zip
 */
export function isAgentLogFilename(filename: string): boolean {
	return /^[a-z]+(?:-timeout)?-[\d-TZ]+\.zip$/i.test(filename);
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
			console.log(`[Router] Card moved to trigger list: ${listId}`);
			return true;
		}
	}

	// Card created directly in a trigger list
	if (actionType === 'createCard' && data?.list) {
		const list = data.list as Record<string, unknown>;
		const listId = list.id as string;
		if (triggerLists.includes(listId)) {
			console.log(`[Router] Card created in trigger list: ${listId}`);
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
		console.log('[Router] Ready-to-process label added');
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
		console.log(`[Router] Agent log attachment uploaded: ${name}`);
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

/**
 * Try to match a trigger and post an ack comment for a Trello webhook.
 * Returns the ack comment ID if posted, undefined otherwise.
 */
export async function tryPostTrelloAck(
	projectId: string,
	cardId: string,
	payload: unknown,
	triggerRegistry: TriggerRegistry,
): Promise<string | undefined> {
	const config = await loadProjectConfig();
	const fullProject = config.fullProjects.find((fp) => fp.id === projectId);
	if (!fullProject) return undefined;

	const ctx: TriggerContext = { project: fullProject, source: 'trello', payload };
	const match = triggerRegistry.matchTrigger(ctx);
	if (!match) return undefined;

	const context = extractTrelloContext(payload);
	const message = await generateAckMessage(match.agentType, context, projectId);

	const commentId = await postTrelloAck(projectId, cardId, message);
	return commentId ?? undefined;
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

export async function processTrelloWebhookEvent(
	project: RouterProjectConfig,
	cardId: string,
	actionType: string,
	payload: unknown,
	triggerRegistry: TriggerRegistry,
): Promise<void> {
	if (actionType === 'commentCard' && (await isSelfAuthoredTrelloComment(payload, project.id))) {
		console.log('[Router] Ignoring self-authored Trello comment');
		return;
	}

	console.log('[Router] Queueing Trello job:', { actionType, cardId, projectId: project.id });

	// Fire-and-forget acknowledgment reaction — only for comment actions
	if (actionType === 'commentCard') {
		void sendAcknowledgeReaction('trello', project.id, payload).catch((err) =>
			console.error('[Router] Trello reaction error:', err),
		);
	}

	// Try to post an ack comment via trigger matching (non-blocking best-effort)
	let ackCommentId: string | undefined;
	try {
		ackCommentId = await tryPostTrelloAck(project.id, cardId, payload, triggerRegistry);
	} catch (err) {
		console.warn('[Router] Trello ack comment failed (non-fatal):', String(err));
	}

	const job: CascadeJob = {
		type: 'trello',
		source: 'trello',
		payload,
		projectId: project.id,
		cardId,
		actionType: actionType || 'unknown',
		receivedAt: new Date().toISOString(),
		ackCommentId,
	};

	try {
		const jobId = await addJob(job);
		console.log('[Router] Trello job queued:', { jobId, actionType, ackCommentId });
	} catch (err) {
		console.error('[Router] Failed to queue Trello job:', err);
		// Still return to caller — Trello gets 200 to avoid retries
	}
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Handle a POST /trello/webhook request.
 * Parses the payload, filters irrelevant events, and queues a job.
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
		console.log(`[Router] Ignoring Trello: ${actionType || 'unknown'}`);
	}

	return { shouldProcess, project, actionType, cardId };
}
