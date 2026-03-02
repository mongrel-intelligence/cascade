import { resolveTrelloTriggerEnabled } from '../../config/triggerConfig.js';
import { getTrelloConfig } from '../../pm/config.js';
import { logger } from '../../utils/logging.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../types.js';
import { type TrelloWebhookPayload, isTrelloWebhookPayload } from './types.js';

// ============================================================================
// Status Changed Trigger Factory (Trello)
// ============================================================================

interface StatusChangedConfig {
	name: string;
	description: string;
	listKey: 'splitting' | 'planning' | 'todo';
	agentType: string;
	triggerConfigKey: 'statusChanged';
}

function createStatusChangedTrigger(config: StatusChangedConfig): TriggerHandler {
	return {
		name: config.name,
		description: config.description,

		matches(ctx: TriggerContext): boolean {
			if (ctx.source !== 'trello') return false;
			if (!isTrelloWebhookPayload(ctx.payload)) return false;

			// Check trigger config — default enabled for backward compatibility
			const trelloConfig = getTrelloConfig(ctx.project);
			if (!resolveTrelloTriggerEnabled(trelloConfig?.triggers, config.triggerConfigKey)) {
				return false;
			}

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
			const payload = ctx.payload as TrelloWebhookPayload;
			const cardId = payload.action.data.card?.id;

			if (!cardId) {
				logger.warn('No card ID in Trello status-changed payload', { trigger: config.name });
				return null;
			}

			return {
				agentType: config.agentType,
				agentInput: { cardId },
				workItemId: cardId,
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
	triggerConfigKey: 'statusChanged',
});

export const TrelloStatusChangedPlanningTrigger = createStatusChangedTrigger({
	name: 'trello-status-changed-planning',
	description: 'Triggers planning agent when card moved to planning list',
	listKey: 'planning',
	agentType: 'planning',
	triggerConfigKey: 'statusChanged',
});

export const TrelloStatusChangedTodoTrigger = createStatusChangedTrigger({
	name: 'trello-status-changed-todo',
	description: 'Triggers implementation agent when card moved to TODO list',
	listKey: 'todo',
	agentType: 'implementation',
	triggerConfigKey: 'statusChanged',
});
