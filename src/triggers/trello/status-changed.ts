import { getTrelloConfig } from '../../pm/config.js';
import { invalidateSnapshot } from '../../router/snapshot-manager.js';
import { logger } from '../../utils/logging.js';
import { checkTriggerEnabled } from '../shared/trigger-check.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../types.js';
import { isTrelloWebhookPayload, type TrelloWebhookPayload } from './types.js';

// ============================================================================
// Status Changed Trigger Factory (Trello)
// ============================================================================

interface StatusChangedConfig {
	name: string;
	description: string;
	listKey: 'splitting' | 'planning' | 'todo' | 'backlog' | 'merged';
	agentType: 'splitting' | 'planning' | 'implementation' | 'backlog-manager';
	/** When true, invalidate any snapshot for the card when it reaches this status */
	invalidateSnapshotOnMove?: boolean;
}

function createStatusChangedTrigger(config: StatusChangedConfig): TriggerHandler {
	return {
		name: config.name,
		description: config.description,

		matches(ctx: TriggerContext): boolean {
			if (ctx.source !== 'trello') return false;
			if (!isTrelloWebhookPayload(ctx.payload)) return false;

			const trelloConfig = getTrelloConfig(ctx.project);
			const payload = ctx.payload;
			const targetListId = trelloConfig?.lists[config.listKey];

			// Card moved into the target list
			const isMove =
				payload.action.type === 'updateCard' &&
				payload.action.data.listAfter?.id === targetListId &&
				payload.action.data.listBefore?.id !== targetListId;

			// Card created directly in the target list
			const isCreate =
				payload.action.type === 'createCard' && payload.action.data.list?.id === targetListId;

			return isMove || isCreate;
		},

		async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
			// Check trigger config via new DB-driven system
			if (
				!(await checkTriggerEnabled(
					ctx.project.id,
					config.agentType,
					'pm:status-changed',
					config.name,
				))
			) {
				return null;
			}

			const payload = ctx.payload as TrelloWebhookPayload;
			const cardId = payload.action.data.card?.id;

			if (!cardId) {
				logger.warn('No card ID in Trello status-changed payload', { trigger: config.name });
				return null;
			}

			// Capture work item display data from the webhook payload
			const cardShortLink = payload.action.data.card?.shortLink;
			const cardName = payload.action.data.card?.name;
			const workItemUrl = cardShortLink ? `https://trello.com/c/${cardShortLink}` : undefined;
			const workItemTitle = cardName ?? undefined;

			// Fire-and-forget: invalidate any stale snapshot for this work item when
			// the card reaches a terminal status (e.g. merged). The snapshot was built
			// for an earlier state and is no longer useful.
			if (config.invalidateSnapshotOnMove) {
				invalidateSnapshot(ctx.project.id, cardId);
			}

			return {
				agentType: config.agentType,
				agentInput: {
					workItemId: cardId,
					workItemUrl,
					workItemTitle,
					triggerEvent: 'pm:status-changed',
				},
				workItemId: cardId,
				workItemUrl,
				workItemTitle,
			};
		},
	};
}

// ============================================================================
// Trigger Instances
// ============================================================================

export const TrelloStatusChangedSplittingTrigger = createStatusChangedTrigger({
	name: 'trello-status-changed-splitting',
	description: 'Triggers splitting agent when card moved to splitting list',
	listKey: 'splitting',
	agentType: 'splitting',
});

export const TrelloStatusChangedPlanningTrigger = createStatusChangedTrigger({
	name: 'trello-status-changed-planning',
	description: 'Triggers planning agent when card moved to planning list',
	listKey: 'planning',
	agentType: 'planning',
});

export const TrelloStatusChangedTodoTrigger = createStatusChangedTrigger({
	name: 'trello-status-changed-todo',
	description: 'Triggers implementation agent when card moved to TODO list',
	listKey: 'todo',
	agentType: 'implementation',
});

export const TrelloStatusChangedBacklogTrigger = createStatusChangedTrigger({
	name: 'trello-status-changed-backlog',
	description: 'Triggers backlog-manager agent when card moved to backlog list',
	listKey: 'backlog',
	agentType: 'backlog-manager',
});

export const TrelloStatusChangedMergedTrigger = createStatusChangedTrigger({
	name: 'trello-status-changed-merged',
	description:
		'Re-triggers backlog-manager when any card is moved to MERGED, so manually resolved dependencies unblock the backlog',
	listKey: 'merged',
	agentType: 'backlog-manager',
	invalidateSnapshotOnMove: true,
});
