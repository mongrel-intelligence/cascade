import { getTrelloConfig } from '../../pm/config.js';
import { invalidateSnapshot } from '../../router/snapshot-manager.js';
import { logger } from '../../utils/logging.js';
import { BUILTIN_WORKFLOW_STATUS_KEYS } from '../../workflow/statusDefinitions.js';
import { shouldBlockForPipelineCapacity } from '../shared/pipeline-capacity-gate.js';
import {
	buildPMStatusDispatchResult,
	resolvePMStatusAgentByIdFromWorkflowDefinitions,
	shouldFirePMStatusEvent,
} from '../shared/pm-status.js';
import { checkTriggerEnabledWithParams } from '../shared/trigger-check.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../types.js';
import { isTrelloWebhookPayload, type TrelloWebhookPayload } from './types.js';

// ============================================================================
// Status Changed Trigger Factory (Trello)
//
// Two independent toggles, gated by params resolved from the DB-driven config:
//   onMove   (default true)  — fire when a card is moved into the target list
//   onCreate (default false) — fire when a card is created directly in the target list
//
// Existing Trello projects are backfilled to { onCreate: true, onMove: true } via
// a data migration so behavior is preserved without relying on YAML defaults.
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

			const isMove =
				payload.action.type === 'updateCard' &&
				payload.action.data.listAfter?.id === targetListId &&
				payload.action.data.listBefore?.id !== targetListId;

			const isCreate =
				payload.action.type === 'createCard' && payload.action.data.list?.id === targetListId;

			return isMove || isCreate;
		},

		// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: sequential guard checks (enabled → fire mode → cardId → capacity)
		async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
			const { enabled, parameters } = await checkTriggerEnabledWithParams(
				ctx.project.id,
				config.agentType,
				'pm:status-changed',
				config.name,
			);
			if (!enabled) {
				return null;
			}

			const payload = ctx.payload as TrelloWebhookPayload;
			const isCreate = payload.action.type === 'createCard';
			if (!shouldFirePMStatusEvent(isCreate, parameters)) {
				logger.debug('Trello status-changed event gated by trigger params', {
					trigger: config.name,
					eventKind: isCreate ? 'create' : 'move',
					parameters,
				});
				return null;
			}

			const cardId = payload.action.data.card?.id;

			if (!cardId) {
				logger.warn('No card ID in Trello status-changed payload', { trigger: config.name });
				return null;
			}

			if (
				await shouldBlockForPipelineCapacity({
					project: ctx.project,
					agentType: config.agentType,
					workItemId: cardId,
					source: 'trello',
				})
			) {
				return null;
			}

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

			return buildPMStatusDispatchResult({
				projectId: ctx.project.id,
				agentType: config.agentType,
				workItemId: cardId,
				workItemUrl,
				workItemTitle,
			});
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

// ============================================================================
// Custom Status Changed Trigger (Trello)
//
// Companion to the built-in per-list triggers above. Matches createCard /
// updateCard events whose destination list ID is configured under a CUSTOM
// (non-built-in) workflow status key. Built-in keys (backlog/splitting/
// planning/todo/inProgress/inReview/done/merged/alerts/friction) are
// excluded — the per-list triggers above already handle the ones that
// dispatch, and the others have a null agentType so dispatch would be a
// no-op anyway.
//
// Custom statuses are resolved through `resolveWorkflowStatusDefinition`,
// matching the JIRA / Linear pattern (MNG-1066). The trigger preserves the
// existing enablement, `onCreate` / `onMove` gating, capacity gate, coalesce
// key, URL/title extraction, and logging conventions of the built-in
// triggers.
// ============================================================================

function findCascadeStatusKeyForListId(
	listId: string,
	lists: Record<string, string>,
): string | undefined {
	for (const [cascadeStatus, configuredListId] of Object.entries(lists)) {
		if (configuredListId === listId) return cascadeStatus;
	}
	return undefined;
}

function resolveDestinationListId(payload: TrelloWebhookPayload): string | undefined {
	if (payload.action.type === 'createCard') return payload.action.data.list?.id;
	if (payload.action.type === 'updateCard') return payload.action.data.listAfter?.id;
	return undefined;
}

function isDestinationListChange(payload: TrelloWebhookPayload, destListId: string): boolean {
	if (payload.action.type === 'createCard') return true;
	if (payload.action.type === 'updateCard') {
		return payload.action.data.listBefore?.id !== destListId;
	}
	return false;
}

export class TrelloCustomStatusChangedTrigger implements TriggerHandler {
	name = 'trello-status-changed-custom';
	description =
		'Triggers custom agent when a card is moved or created in a list mapped to a custom workflow status';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'trello') return false;
		if (!isTrelloWebhookPayload(ctx.payload)) return false;

		const trelloConfig = getTrelloConfig(ctx.project);
		if (!trelloConfig?.lists) return false;

		const payload = ctx.payload;
		const destListId = resolveDestinationListId(payload);
		if (!destListId) return false;

		// Only handle real destination changes (createCard, or updateCard with a
		// different listBefore).
		if (!isDestinationListChange(payload, destListId)) return false;

		const cascadeStatus = findCascadeStatusKeyForListId(destListId, trelloConfig.lists);
		if (!cascadeStatus) return false;

		// Built-in cascade status keys are handled by the per-list triggers
		// above (or have no agentType). Only claim custom keys here.
		return !BUILTIN_WORKFLOW_STATUS_KEYS.has(cascadeStatus);
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		const payload = ctx.payload as TrelloWebhookPayload;
		const trelloConfig = getTrelloConfig(ctx.project);
		if (!trelloConfig?.lists) return null;

		const destListId = resolveDestinationListId(payload);
		if (!destListId) return null;

		const resolved = await resolvePMStatusAgentByIdFromWorkflowDefinitions({
			statusId: destListId,
			configuredStatuses: trelloConfig.lists,
		});
		if (!resolved) {
			logger.debug('Trello custom status-change does not map to any agent', {
				trigger: this.name,
				destListId,
				configuredLists: trelloConfig.lists,
			});
			return null;
		}
		const { agentType, cascadeStatus: matchedCascadeStatus } = resolved;

		const { enabled, parameters } = await checkTriggerEnabledWithParams(
			ctx.project.id,
			agentType,
			'pm:status-changed',
			this.name,
		);
		if (!enabled) return null;

		const isCreate = payload.action.type === 'createCard';
		if (!shouldFirePMStatusEvent(isCreate, parameters)) {
			logger.debug('Trello custom status-changed event gated by trigger params', {
				trigger: this.name,
				eventKind: isCreate ? 'create' : 'move',
				parameters,
			});
			return null;
		}

		const cardId = payload.action.data.card?.id;
		if (!cardId) {
			logger.warn('No card ID in Trello custom status-changed payload', { trigger: this.name });
			return null;
		}

		if (
			await shouldBlockForPipelineCapacity({
				project: ctx.project,
				agentType,
				workItemId: cardId,
				source: 'trello',
			})
		) {
			return null;
		}

		const cardShortLink = payload.action.data.card?.shortLink;
		const cardName = payload.action.data.card?.name;
		const workItemUrl = cardShortLink ? `https://trello.com/c/${cardShortLink}` : undefined;
		const workItemTitle = cardName ?? undefined;

		logger.info('Trello card entered custom agent-triggering list', {
			cardId,
			destListId,
			eventKind: isCreate ? 'create' : 'move',
			cascadeStatus: matchedCascadeStatus,
			agentType,
		});

		return buildPMStatusDispatchResult({
			projectId: ctx.project.id,
			agentType,
			workItemId: cardId,
			workItemUrl,
			workItemTitle,
		});
	}
}
