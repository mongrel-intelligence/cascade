import { resolveTrelloTriggerEnabled } from '../../config/triggerConfig.js';
import { getTrelloConfig } from '../../pm/config.js';
import { trelloClient } from '../../trello/client.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import type { TrelloWebhookPayload } from '../types.js';
import { isTrelloWebhookPayload } from '../types.js';

// Cache authenticated member info to avoid repeated API calls
let cachedMemberInfo: { id: string; username: string } | null = null;

async function getAuthenticatedMemberInfo(): Promise<{ id: string; username: string }> {
	if (cachedMemberInfo) {
		return cachedMemberInfo;
	}
	const me = await trelloClient.getMe();
	cachedMemberInfo = { id: me.id, username: me.username };
	logger.info('Cached authenticated member info', {
		memberId: cachedMemberInfo.id,
		username: cachedMemberInfo.username,
	});
	return cachedMemberInfo;
}

/**
 * Trigger that fires when someone @mentions the CASCADE bot in a Trello card comment
 * on a card in the PLANNING list. Runs the respond-to-planning-comment agent.
 * Returns null (falls through) when there's no @mention, card isn't in PLANNING,
 * or the comment is self-authored.
 */
export class TrelloCommentMentionTrigger implements TriggerHandler {
	name = 'trello-comment-mention';
	description =
		'Triggers respond-to-planning-comment agent when someone @mentions the bot in a comment on a PLANNING card';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'trello') return false;
		if (!isTrelloWebhookPayload(ctx.payload)) return false;

		// Check trigger config — default enabled for backward compatibility
		if (!resolveTrelloTriggerEnabled(getTrelloConfig(ctx.project)?.triggers, 'commentMention')) {
			return false;
		}

		return ctx.payload.action.type === 'commentCard';
	}

	resolveAgentType(): string {
		return 'respond-to-planning-comment';
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		const payload = ctx.payload as TrelloWebhookPayload;
		const cardId = payload.action.data.card?.id;
		const commentText = payload.action.data.text;

		if (!cardId || !commentText) {
			return null;
		}

		// Resolve our Trello identity
		const memberInfo = await getAuthenticatedMemberInfo();

		// Check for @mention (case-insensitive)
		const mentionPattern = new RegExp(`@${memberInfo.username}\\b`, 'i');
		if (!mentionPattern.test(commentText)) {
			return null;
		}

		// Skip self-authored comments to prevent infinite loops
		if (payload.action.idMemberCreator === memberInfo.id) {
			logger.debug('Skipping self-authored comment to prevent infinite loop', {
				cardId,
				memberId: memberInfo.id,
			});
			return null;
		}

		// Fetch card to verify it's in the PLANNING list
		const planningListId = getTrelloConfig(ctx.project)?.lists.planning;
		if (!planningListId) {
			logger.debug('Planning list not configured, skipping comment mention trigger', {
				projectId: ctx.project.id,
			});
			return null;
		}

		const card = await trelloClient.getCard(cardId);
		if (card.idList !== planningListId) {
			logger.debug('Card not in PLANNING list, skipping comment mention trigger', {
				cardId,
				cardList: card.idList,
				planningList: planningListId,
			});
			return null;
		}

		// Extract comment author username
		const commentAuthor = payload.action.memberCreator?.username || 'unknown';

		logger.info('Trello comment @mention detected on PLANNING card, triggering agent', {
			cardId,
			commentAuthor,
			botUsername: memberInfo.username,
		});

		return {
			agentType: 'respond-to-planning-comment',
			agentInput: {
				cardId,
				triggerCommentText: commentText,
				triggerCommentAuthor: commentAuthor,
			},
			workItemId: cardId,
		};
	}
}
