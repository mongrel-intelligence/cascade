import { TRPCError } from '@trpc/server';
import { logger } from '../../../utils/logging.js';
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
	// Delete any existing webhooks for this board first to prevent duplicates.
	// Trello webhooks are token-scoped and board-scoped, so all webhooks returned
	// by trelloListWebhooks are CASCADE-owned webhooks for this board.
	const existingWebhooks = await trelloListWebhooks(ctx);
	for (const webhook of existingWebhooks) {
		try {
			await trelloDeleteWebhook(ctx, webhook.id);
			logger.info('[TrelloWebhook] Deleted existing webhook to prevent duplicates', {
				webhookId: webhook.id,
				projectId: ctx.projectId,
				boardId: ctx.boardId,
			});
		} catch (err) {
			// Log and continue — failing to delete an old webhook shouldn't prevent
			// creating a new one. Worst case: we end up with duplicates (which the
			// action-level dedup in the router will handle).
			logger.warn('[TrelloWebhook] Failed to delete existing webhook (continuing)', {
				webhookId: webhook.id,
				projectId: ctx.projectId,
				error: String(err),
			});
		}
	}

	// Now create the new webhook
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
