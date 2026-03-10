/**
 * TrelloRouterAdapter — platform-specific logic for the router-side
 * Trello webhook processing pipeline.
 *
 * Extracts the logic previously embedded in `router/trello.ts` into the
 * `RouterPlatformAdapter` interface so it can be driven by the generic
 * `processRouterWebhook()` function.
 */

import { withTrelloCredentials } from '../../trello/client.js';
import type { TriggerRegistry } from '../../triggers/registry.js';
import type { TriggerContext, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { extractTrelloContext, generateAckMessage } from '../ackMessageGenerator.js';
import { postTrelloAck } from '../acknowledgments.js';
import { type RouterProjectConfig, loadProjectConfig } from '../config.js';
import type { AckResult, ParsedWebhookEvent, RouterPlatformAdapter } from '../platform-adapter.js';
import { resolveTrelloCredentials } from '../platformClients/index.js';
import type { CascadeJob, TrelloJob } from '../queue.js';
import { sendAcknowledgeReaction } from '../reactions.js';
import {
	isAgentLogAttachmentUploaded,
	isCardInTriggerList,
	isReadyToProcessLabelAdded,
	isSelfAuthoredTrelloComment,
} from '../trello.js';

export class TrelloRouterAdapter implements RouterPlatformAdapter {
	readonly type = 'trello' as const;

	async parseWebhook(payload: unknown): Promise<ParsedWebhookEvent | null> {
		if (!payload || typeof payload !== 'object') return null;

		const p = payload as Record<string, unknown>;
		const action = p.action as Record<string, unknown> | undefined;
		const model = p.model as Record<string, unknown> | undefined;

		if (!action || !model) return null;

		const boardId = model.id as string;
		const actionType = action.type as string;
		const actionId = action.id as string | undefined;
		const data = action.data as Record<string, unknown> | undefined;

		const config = await loadProjectConfig();
		const project = config.projects.find((proj) => proj.trello?.boardId === boardId);
		if (!project) return null;

		const card = data?.card as Record<string, unknown> | undefined;
		const workItemId = card?.id as string | undefined;

		const isProcessable =
			isCardInTriggerList(actionType, data, project) ||
			isReadyToProcessLabelAdded(actionType, data, project) ||
			isAgentLogAttachmentUploaded(actionType, data, project) ||
			actionType === 'commentCard';

		if (!isProcessable) return null;

		return {
			projectIdentifier: boardId,
			eventType: actionType,
			workItemId,
			isCommentEvent: actionType === 'commentCard',
			actionId,
		};
	}

	isProcessableEvent(_event: ParsedWebhookEvent): boolean {
		// Filtering is already done in parseWebhook (returns null for non-processable)
		return true;
	}

	async isSelfAuthored(event: ParsedWebhookEvent, payload: unknown): Promise<boolean> {
		if (!event.isCommentEvent) return false;

		const config = await loadProjectConfig();
		const project = config.projects.find((p) => p.trello?.boardId === event.projectIdentifier);
		if (!project) return false;

		return isSelfAuthoredTrelloComment(payload, project.id);
	}

	sendReaction(event: ParsedWebhookEvent, payload: unknown): void {
		if (!event.isCommentEvent) return;
		void (async () => {
			try {
				const config = await loadProjectConfig();
				const project = config.projects.find((p) => p.trello?.boardId === event.projectIdentifier);
				if (!project) return;
				await sendAcknowledgeReaction('trello', project.id, payload);
			} catch (err) {
				logger.error('Trello reaction error', { error: String(err) });
			}
		})();
	}

	async resolveProject(event: ParsedWebhookEvent): Promise<RouterProjectConfig | null> {
		const config = await loadProjectConfig();
		return config.projects.find((p) => p.trello?.boardId === event.projectIdentifier) ?? null;
	}

	async dispatchWithCredentials(
		_event: ParsedWebhookEvent,
		payload: unknown,
		project: RouterProjectConfig,
		triggerRegistry: TriggerRegistry,
	): Promise<TriggerResult | null> {
		const config = await loadProjectConfig();
		const fullProject = config.fullProjects.find((fp) => fp.id === project.id);
		if (!fullProject) {
			logger.info('No full project config for Trello webhook, skipping', {
				projectId: project.id,
			});
			return null;
		}

		const trelloCreds = await resolveTrelloCredentials(project.id);
		if (!trelloCreds) {
			logger.warn('Missing Trello credentials, cannot dispatch triggers', {
				projectId: project.id,
			});
			return null;
		}

		const ctx: TriggerContext = { project: fullProject, source: 'trello', payload };
		return withTrelloCredentials(trelloCreds, () => triggerRegistry.dispatch(ctx));
	}

	async postAck(
		event: ParsedWebhookEvent,
		payload: unknown,
		project: RouterProjectConfig,
		agentType: string,
		_triggerResult?: TriggerResult,
	): Promise<AckResult | undefined> {
		if (!event.workItemId) return undefined;
		try {
			const context = extractTrelloContext(payload);
			const message = await generateAckMessage(agentType, context, project.id);
			const commentId = await postTrelloAck(project.id, event.workItemId, message);
			if (commentId) return { commentId, message };
			return undefined;
		} catch (err) {
			logger.warn('Trello ack comment failed (non-fatal)', {
				error: String(err),
				cardId: event.workItemId,
			});
			return undefined;
		}
	}

	buildJob(
		event: ParsedWebhookEvent,
		payload: unknown,
		project: RouterProjectConfig,
		result: TriggerResult,
		ackResult?: AckResult,
	): CascadeJob {
		const job: TrelloJob = {
			type: 'trello',
			source: 'trello',
			payload,
			projectId: project.id,
			cardId: event.workItemId ?? '',
			actionType: event.eventType,
			receivedAt: new Date().toISOString(),
			triggerResult: result,
			ackCommentId: ackResult?.commentId as string | undefined,
		};
		return job;
	}
}
