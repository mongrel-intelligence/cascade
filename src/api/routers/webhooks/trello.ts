import { TRPCError } from '@trpc/server';
import type { ProjectContext, TrelloWebhook } from './types.js';

export async function trelloListWebhooks(ctx: ProjectContext): Promise<TrelloWebhook[]> {
	if (!ctx.trelloApiKey || !ctx.trelloToken || !ctx.boardId) return [];
	const response = await fetch(
		`https://api.trello.com/1/tokens/${ctx.trelloToken}/webhooks?key=${ctx.trelloApiKey}`,
	);
	if (!response.ok) {
		throw new TRPCError({
			code: 'INTERNAL_SERVER_ERROR',
			message: `Failed to list Trello webhooks: ${response.status}`,
		});
	}
	const webhooks = (await response.json()) as TrelloWebhook[];
	return webhooks.filter((w) => w.idModel === ctx.boardId);
}

export async function trelloCreateWebhook(
	ctx: ProjectContext,
	callbackURL: string,
): Promise<TrelloWebhook> {
	const response = await fetch(
		`https://api.trello.com/1/webhooks/?key=${ctx.trelloApiKey}&token=${ctx.trelloToken}`,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				callbackURL,
				idModel: ctx.boardId,
				description: `CASCADE webhook for project ${ctx.projectId}`,
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

export async function trelloDeleteWebhook(ctx: ProjectContext, webhookId: string): Promise<void> {
	const response = await fetch(
		`https://api.trello.com/1/webhooks/${webhookId}?key=${ctx.trelloApiKey}&token=${ctx.trelloToken}`,
		{ method: 'DELETE' },
	);
	if (!response.ok) {
		throw new TRPCError({
			code: 'INTERNAL_SERVER_ERROR',
			message: `Failed to delete Trello webhook ${webhookId}: ${response.status}`,
		});
	}
}
