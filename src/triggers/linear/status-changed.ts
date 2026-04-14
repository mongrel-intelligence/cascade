/**
 * Linear status-changed trigger.
 *
 * Fires when a Linear issue transitions to a configured state (by state ID)
 * that maps to a CASCADE agent type (splitting, planning, implementation).
 *
 * Linear webhook structure for status changes:
 *   action: 'update', type: 'Issue'
 *   data.stateId: new state ID
 *   updatedFrom.stateId: previous state ID (only present when stateId changed)
 */

import { getLinearConfig } from '../../pm/config.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { checkTriggerEnabled } from '../shared/trigger-check.js';
import { type LinearWebhookTriggerPayload, STATUS_TO_AGENT } from './types.js';

export class LinearStatusChangedTrigger implements TriggerHandler {
	name = 'linear-status-changed';
	description = 'Triggers agent when a Linear issue transitions to a configured state';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'linear') return false;

		const payload = ctx.payload as LinearWebhookTriggerPayload;
		if (payload.action !== 'update' || payload.type !== 'Issue') return false;

		// Must have a state change indicated by updatedFrom.stateId
		return typeof payload.updatedFrom?.stateId === 'string';
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

		const linearConfig = getLinearConfig(ctx.project);
		if (!linearConfig?.statuses) {
			logger.debug('No Linear status configuration, skipping status-changed trigger', {
				projectId: ctx.project.id,
			});
			return null;
		}

		// Find which CASCADE status key maps to this Linear state ID
		let agentType: string | undefined;
		let matchedCascadeStatus: string | undefined;
		for (const [cascadeStatus, linearStateId] of Object.entries(linearConfig.statuses)) {
			if (linearStateId === newStateId) {
				agentType = STATUS_TO_AGENT[cascadeStatus];
				matchedCascadeStatus = cascadeStatus;
				break;
			}
		}

		if (!agentType) {
			logger.debug('Linear state transition does not map to any agent', {
				issueIdentifier,
				newStateId,
				configuredStatuses: linearConfig.statuses,
			});
			return null;
		}

		// Check per-agent toggle for statusChanged via DB-driven system
		if (!(await checkTriggerEnabled(ctx.project.id, agentType, 'pm:status-changed', this.name))) {
			return null;
		}

		logger.info('Linear issue transitioned to agent-triggering state', {
			issueIdentifier,
			previousStateId: payload.updatedFrom?.stateId,
			newStateId,
			cascadeStatus: matchedCascadeStatus,
			agentType,
		});

		// Use issueIdentifier (e.g. TEAM-123) as the workItemId, falling back to id
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
		};
	}
}
