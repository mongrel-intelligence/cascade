import { TRPCError } from '@trpc/server';
import type { TrelloWebhook, WebhookManager } from './types.js';

interface TrelloContext {
	trelloApiKey: string;
	trelloToken: string;
	boardId?: string;
	projectId: string;
}

export class TrelloWebhookManager implements WebhookManager<TrelloWebhook, string> {
	constructor(private readonly ctx: TrelloContext) {}

	async list(): Promise<TrelloWebhook[]> {
		const { trelloApiKey, trelloToken, boardId } = this.ctx;
		if (!trelloApiKey || !trelloToken || !boardId) return [];

		const response = await fetch(
			`https://api.trello.com/1/tokens/${trelloToken}/webhooks?key=${trelloApiKey}`,
		);
		if (!response.ok) {
			throw new TRPCError({
				code: 'INTERNAL_SERVER_ERROR',
				message: `Failed to list Trello webhooks: ${response.status}`,
			});
		}
		const webhooks = (await response.json()) as TrelloWebhook[];
		return webhooks.filter((w) => w.idModel === boardId);
	}

	async create(callbackURL: string): Promise<TrelloWebhook> {
		const { trelloApiKey, trelloToken, boardId, projectId } = this.ctx;
		const response = await fetch(
			`https://api.trello.com/1/webhooks/?key=${trelloApiKey}&token=${trelloToken}`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					callbackURL,
					idModel: boardId,
					description: `CASCADE webhook for project ${projectId}`,
				}),
			},
		);
		if (!response.ok) {
			throw new TRPCError({
				code: 'INTERNAL_SERVER_ERROR',
				message: `Failed to create Trello webhook: ${response.status}`,
			});
		}
		return (await response.json()) as TrelloWebhook;
	}

	async delete(webhookId: string): Promise<void> {
		const { trelloApiKey, trelloToken } = this.ctx;
		const response = await fetch(
			`https://api.trello.com/1/webhooks/${webhookId}?key=${trelloApiKey}&token=${trelloToken}`,
			{ method: 'DELETE' },
		);
		if (!response.ok) {
			throw new TRPCError({
				code: 'INTERNAL_SERVER_ERROR',
				message: `Failed to delete Trello webhook ${webhookId}: ${response.status}`,
			});
		}
	}
}
