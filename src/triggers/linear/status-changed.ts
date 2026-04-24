/**
 * Linear status-changed trigger.
 *
 * Fires when a Linear issue either transitions into or is created in a
 * configured state (by state ID) that maps to a CASCADE agent type.
 *
 * Two independent triggers, gated by params:
 *   onMove   (default true)  — fire when data.stateId changed on an update event
 *   onCreate (default false) — fire when an issue is created directly in a mapped state
 *
 * Linear webhook shapes:
 *   Update: action='update', type='Issue', data.stateId=new, updatedFrom.stateId=old
 *   Create: action='create', type='Issue', data.stateId=initial, no updatedFrom
 */

import { getLinearConfig } from '../../pm/config.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { checkTriggerEnabledWithParams } from '../shared/trigger-check.js';
import { type LinearWebhookTriggerPayload, STATUS_TO_AGENT } from './types.js';

function resolveAgentType(
	newStateId: string,
	configStatuses: Record<string, string>,
): { agentType: string; cascadeStatus: string } | undefined {
	for (const [cascadeStatus, linearStateId] of Object.entries(configStatuses)) {
		if (linearStateId === newStateId) {
			const agentType = STATUS_TO_AGENT[cascadeStatus];
			if (agentType) return { agentType, cascadeStatus };
		}
	}
	return undefined;
}

function shouldFireOnEvent(isCreate: boolean, parameters: Record<string, unknown>): boolean {
	if (isCreate) return parameters.onCreate === true;
	return parameters.onMove !== false; // default true
}

export class LinearStatusChangedTrigger implements TriggerHandler {
	name = 'linear-status-changed';
	description = 'Triggers agent when a Linear issue transitions to a configured state';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'linear') return false;

		const payload = ctx.payload as LinearWebhookTriggerPayload;
		if (payload.type !== 'Issue') return false;

		// Create path: require data.stateId so handle() has something to map
		if (payload.action === 'create') {
			const data = payload.data as Record<string, unknown>;
			return typeof data.stateId === 'string';
		}

		// Update path: state change indicated by updatedFrom.stateId
		if (payload.action === 'update') {
			return typeof payload.updatedFrom?.stateId === 'string';
		}

		return false;
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		const payload = ctx.payload as LinearWebhookTriggerPayload;
		const data = payload.data as Record<string, unknown>;

		const newStateId = data.stateId as string | undefined;
		const issueIdentifier =
			(data.identifier as string | undefined) ?? (data.id as string | undefined);
		const issueId = data.id as string | undefined;
		const issueTitle = data.title as string | undefined;
		const issueUrl = data.url as string | undefined;

		if (!newStateId || !issueIdentifier) {
			return null;
		}

		// For update events that don't ultimately trigger an agent, return a
		// coalesce-only result (agentType: null) instead of null. This maintains
		// symmetry with the JIRA coalesce fix — the router can still call
		// clearPendingCreate() before exiting, ensuring a stale create can't fire
		// after an unmapped update arrives within the coalesce window.
		const isCreate = payload.action === 'create';
		const coalesceUpdateResult: TriggerResult | null = isCreate
			? null
			: {
					agentType: null,
					agentInput: { workItemId: issueIdentifier },
					coalesceKey: `${ctx.project.id}:${issueIdentifier}`,
					coalesceRole: 'update',
				};

		const linearConfig = getLinearConfig(ctx.project);
		if (!linearConfig?.statuses) {
			logger.debug('No Linear status configuration, skipping status-changed trigger', {
				projectId: ctx.project.id,
			});
			return coalesceUpdateResult;
		}

		const resolved = resolveAgentType(newStateId, linearConfig.statuses);
		if (!resolved) {
			logger.debug('Linear state transition does not map to any agent', {
				issueIdentifier,
				newStateId,
				configuredStatuses: linearConfig.statuses,
			});
			return coalesceUpdateResult;
		}
		const { agentType, cascadeStatus: matchedCascadeStatus } = resolved;

		const { enabled, parameters } = await checkTriggerEnabledWithParams(
			ctx.project.id,
			agentType,
			'pm:status-changed',
			this.name,
		);
		if (!enabled) return coalesceUpdateResult;

		if (!shouldFireOnEvent(isCreate, parameters)) {
			logger.debug('Linear status-changed event gated by trigger params', {
				issueIdentifier,
				agentType,
				eventKind: isCreate ? 'create' : 'move',
				parameters,
			});
			return coalesceUpdateResult;
		}

		logger.info('Linear issue entered agent-triggering state', {
			issueIdentifier,
			eventKind: isCreate ? 'create' : 'move',
			previousStateId: isCreate ? undefined : payload.updatedFrom?.stateId,
			newStateId,
			cascadeStatus: matchedCascadeStatus,
			agentType,
		});

		const workItemId = issueIdentifier;
		const workItemUrl = issueUrl;
		const workItemTitle = issueTitle;

		return {
			agentType,
			agentInput: {
				workItemId,
				workItemUrl,
				workItemTitle,
				triggerEvent: 'pm:status-changed',
				linearIssueId: issueId,
			},
			workItemId,
			workItemUrl,
			workItemTitle,
			coalesceKey: `${ctx.project.id}:${workItemId}`,
			coalesceRole: isCreate ? 'create' : 'update',
		};
	}
}
