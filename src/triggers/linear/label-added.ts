/**
 * Linear "Ready to Process" label trigger.
 *
 * Fires when an IssueLabel is created (action=create, type=IssueLabel)
 * matching the configured readyToProcess label. Determines which agent to run
 * based on the issue's current state, using the same state→agent mapping as
 * the status-changed trigger.
 *
 * Linear webhook structure for label additions:
 *   action: 'create', type: 'IssueLabel'
 *   data.labelId: the added label ID
 *   data.label.name: the label name
 *   data.issue.stateId: current state ID of the issue
 */

import { getLinearConfig } from '../../pm/config.js';
import { resolveProjectPMConfig } from '../../pm/lifecycle.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { buildPMLabelDispatchResult, resolvePMLabelAgentByStatusId } from '../shared/pm-label.js';
import { checkTriggerEnabled } from '../shared/trigger-check.js';
import type { LinearWebhookIssueLabelData, LinearWebhookTriggerPayload } from './types.js';

export class LinearReadyToProcessLabelTrigger implements TriggerHandler {
	name = 'linear-ready-to-process-label-added';
	description = 'Triggers agent based on current state when "Ready to Process" label is added';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'linear') return false;

		const payload = ctx.payload as LinearWebhookTriggerPayload;
		if (payload.action !== 'create' || payload.type !== 'IssueLabel') return false;

		// Check that the configured readyToProcess label was actually added
		const pmConfig = resolveProjectPMConfig(ctx.project);
		const readyLabel = pmConfig.labels.readyToProcess;
		if (!readyLabel) return false;

		const data = payload.data as LinearWebhookIssueLabelData;
		const labelName = data.label?.name;
		if (!labelName) return false;

		return labelName === readyLabel || data.labelId === readyLabel;
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		const payload = ctx.payload as LinearWebhookTriggerPayload;
		const data = payload.data as LinearWebhookIssueLabelData;

		const issue = data.issue;
		const issueIdentifier = issue?.identifier ?? issue?.id;
		const issueId = issue?.id;
		const issueUrl = issue?.url;
		const issueStateId = issue?.stateId;

		if (!issueIdentifier) {
			logger.debug('Linear label trigger: missing issue identifier, skipping');
			return null;
		}

		if (!issueStateId) {
			logger.debug('No state ID on Linear issue, cannot determine agent type', {
				issueIdentifier,
			});
			return null;
		}

		const linearConfig = getLinearConfig(ctx.project);
		if (!linearConfig?.statuses) {
			logger.debug('No Linear status configuration, skipping label trigger', {
				projectId: ctx.project.id,
			});
			return null;
		}

		const resolved = resolvePMLabelAgentByStatusId({
			statusId: issueStateId,
			configuredStatuses: linearConfig.statuses,
		});
		if (!resolved) {
			logger.debug('Linear issue state does not map to any agent', {
				issueIdentifier,
				issueStateId,
				configuredStatuses: linearConfig.statuses,
			});
			return null;
		}
		const { agentType, cascadeStatus: matchedCascadeStatus } = resolved;

		// Check per-agent ready-to-process toggle via DB-driven system
		if (!(await checkTriggerEnabled(ctx.project.id, agentType, 'pm:label-added', this.name))) {
			return null;
		}

		logger.info('Linear "Ready to Process" label added, triggering agent', {
			issueIdentifier,
			issueStateId,
			cascadeStatus: matchedCascadeStatus,
			agentType,
		});

		const workItemId = issueIdentifier;
		const workItemUrl = issueUrl;
		// Issue title is not included in IssueLabel webhook data
		const workItemTitle: string | undefined = undefined;

		return buildPMLabelDispatchResult({
			agentType,
			workItemId,
			workItemUrl,
			workItemTitle,
			agentInput: {
				linearIssueId: issueId,
			},
		});
	}
}
