/**
 * TrelloIntegration — implements PMIntegration for Trello.
 *
 * Encapsulates all Trello-specific concerns: credential resolution,
 * webhook parsing, ack comments, reactions, project lookup, and triggers.
 *
 * Router-side operations (ack comments, reactions, bot identity) delegate
 * to the single-source-of-truth functions in router/acknowledgments.ts
 * and router/reactions.ts.
 */

import { getIntegrationCredential, loadProjectConfigByBoardId } from '../../config/provider.js';
import {
	deleteTrelloAck,
	postTrelloAck,
	resolveTrelloBotMemberId,
} from '../../router/acknowledgments.js';
import { sendAcknowledgeReaction } from '../../router/reactions.js';
import { withTrelloCredentials } from '../../trello/client.js';
import type { CascadeConfig, ProjectConfig } from '../../types/index.js';
import { getTrelloConfig } from '../config.js';
import type { PMIntegration, PMWebhookEvent } from '../integration.js';
import type { ProjectPMConfig } from '../lifecycle.js';
import type { PMProvider } from '../types.js';
import { TrelloPMProvider } from './adapter.js';

export class TrelloIntegration implements PMIntegration {
	readonly type = 'trello';

	createProvider(_project: ProjectConfig): PMProvider {
		return new TrelloPMProvider();
	}

	async withCredentials<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
		const apiKey = await getIntegrationCredential(projectId, 'pm', 'api_key');
		const token = await getIntegrationCredential(projectId, 'pm', 'token');
		return withTrelloCredentials({ apiKey, token }, fn);
	}

	resolveLifecycleConfig(project: ProjectConfig): ProjectPMConfig {
		const trelloConfig = getTrelloConfig(project);
		return {
			labels: {
				processing: trelloConfig?.labels?.processing,
				processed: trelloConfig?.labels?.processed,
				error: trelloConfig?.labels?.error,
				readyToProcess: trelloConfig?.labels?.readyToProcess,
			},
			statuses: {
				backlog: trelloConfig?.lists?.backlog,
				inProgress: trelloConfig?.lists?.inProgress,
				inReview: trelloConfig?.lists?.inReview,
				done: trelloConfig?.lists?.done,
				merged: trelloConfig?.lists?.merged,
			},
		};
	}

	parseWebhookPayload(raw: unknown): PMWebhookEvent | null {
		if (!raw || typeof raw !== 'object') return null;
		const p = raw as Record<string, unknown>;
		const action = p.action as Record<string, unknown> | undefined;
		const model = p.model as Record<string, unknown> | undefined;
		if (!action || !model) return null;

		const boardId = model.id as string;
		const actionType = action.type as string;
		const data = action.data as Record<string, unknown> | undefined;
		const card = data?.card as Record<string, unknown> | undefined;
		const cardId = card?.id as string | undefined;

		return {
			eventType: actionType,
			projectIdentifier: boardId,
			workItemId: cardId,
			raw,
		};
	}

	async isSelfAuthored(event: PMWebhookEvent, projectId: string): Promise<boolean> {
		const p = event.raw as Record<string, unknown>;
		const action = p.action as Record<string, unknown> | undefined;
		const commentAuthorId = action?.idMemberCreator as string | undefined;
		if (!commentAuthorId) return false;

		try {
			const botId = await resolveTrelloBotMemberId(projectId);
			return !!botId && commentAuthorId === botId;
		} catch {
			return false;
		}
	}

	async postAckComment(
		projectId: string,
		workItemId: string,
		message: string,
	): Promise<string | null> {
		return postTrelloAck(projectId, workItemId, message);
	}

	async deleteAckComment(projectId: string, workItemId: string, commentId: string): Promise<void> {
		return deleteTrelloAck(projectId, workItemId, commentId);
	}

	async sendReaction(projectId: string, event: PMWebhookEvent): Promise<void> {
		return sendAcknowledgeReaction('trello', projectId, event.raw);
	}

	async lookupProject(
		identifier: string,
	): Promise<{ project: ProjectConfig; config: CascadeConfig } | null> {
		return (await loadProjectConfigByBoardId(identifier)) ?? null;
	}

	extractWorkItemId(text: string): string | null {
		const match = text.match(/https:\/\/trello\.com\/c\/([a-zA-Z0-9]+)/);
		return match ? match[1] : null;
	}
}
