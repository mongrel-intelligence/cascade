/**
 * JIRA status-changed trigger.
 *
 * Fires when a JIRA issue either transitions into or is created in a configured
 * status that maps to a CASCADE agent type.
 *
 * Two independent triggers, gated by params:
 *   onMove   (default true)  — fire on a jira:issue_updated event with a status changelog item
 *   onCreate (default false) — fire on a jira:issue_created event with a resolvable status
 */

import { getJiraConfig } from '../../pm/config.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { shouldBlockForPipelineCapacity } from '../shared/pipeline-capacity-gate.js';
import {
	buildPMStatusDispatchResult,
	resolvePMStatusAgentByIdOrNameFromWorkflowDefinitions,
	shouldFirePMStatusEvent,
} from '../shared/pm-status.js';
import { checkTriggerEnabledWithParams } from '../shared/trigger-check.js';
import type { JiraWebhookPayload } from './types.js';

function isCreateEvent(payload: JiraWebhookPayload): boolean {
	return payload.webhookEvent === 'jira:issue_created';
}

function findStatusChange(
	payload: JiraWebhookPayload,
): { from?: string; to?: string; fromString?: string; toString?: string } | undefined {
	return payload.changelog?.items?.find((item) => item.field === 'status');
}

/**
 * The new status a JIRA webhook is transitioning into.
 *
 * MNG-1768: `id` is the locale-invariant status ID (matched first); `name`
 * is the localized status name (matched as a fallback). At least one must be
 * present for the trigger to attempt a resolution.
 */
interface ResolvedNewStatus {
	id?: string;
	name?: string;
}

/**
 * Resolve the new status (id + name) from a JIRA webhook payload.
 * Returns `undefined` when neither identity can be determined.
 */
function resolveNewStatus(payload: JiraWebhookPayload): ResolvedNewStatus | undefined {
	if (isCreateEvent(payload)) {
		const status = payload.issue?.fields?.status;
		if (!status?.id && !status?.name) return undefined;
		return { id: status.id, name: status.name };
	}
	const change = findStatusChange(payload);
	if (!change?.to && !change?.toString) return undefined;
	return { id: change.to, name: change.toString };
}

export class JiraStatusChangedTrigger implements TriggerHandler {
	name = 'jira-status-changed';
	description = 'Triggers agent when a JIRA issue transitions to a configured status';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'jira') return false;

		const payload = ctx.payload as JiraWebhookPayload;

		// Create path: require a resolvable status (id or name) so handle() has
		// something to map. JIRA always sends both, but accepting either keeps
		// the match path consistent with the id-or-name read path.
		if (isCreateEvent(payload)) {
			const status = payload.issue?.fields?.status;
			return typeof status?.id === 'string' || typeof status?.name === 'string';
		}

		if (!payload.webhookEvent?.startsWith('jira:issue_updated')) return false;

		// Update path: must have a status change in the changelog
		return !!findStatusChange(payload);
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		const payload = ctx.payload as JiraWebhookPayload;
		const issueKey = payload.issue?.key;

		if (!issueKey) {
			return null;
		}

		const newStatus = resolveNewStatus(payload);
		if (!newStatus) {
			return null;
		}

		const jiraConfig = getJiraConfig(ctx.project);
		if (!jiraConfig?.statuses) {
			logger.debug('No JIRA status configuration, skipping status-changed trigger', {
				projectId: ctx.project.id,
			});
			return null;
		}

		// MNG-1768: match on the locale-invariant status ID first, falling back
		// to the localized status name so existing name-based configs keep
		// dispatching untouched.
		const resolved = await resolvePMStatusAgentByIdOrNameFromWorkflowDefinitions({
			statusId: newStatus.id,
			statusName: newStatus.name,
			configuredStatuses: jiraConfig.statuses,
		});
		if (!resolved) {
			logger.debug('JIRA status transition does not map to any agent', {
				issueKey,
				newStatusId: newStatus.id,
				newStatusName: newStatus.name,
				configuredStatuses: jiraConfig.statuses,
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

		const isCreate = isCreateEvent(payload);
		if (!shouldFirePMStatusEvent(isCreate, parameters)) {
			logger.debug('JIRA status-changed event gated by trigger params', {
				issueKey,
				agentType,
				eventKind: isCreate ? 'create' : 'move',
				parameters,
			});
			return null;
		}

		if (
			await shouldBlockForPipelineCapacity({
				project: ctx.project,
				agentType,
				workItemId: issueKey,
				source: 'jira',
			})
		) {
			return null;
		}

		const statusChange = findStatusChange(payload);
		logger.info('JIRA issue entered agent-triggering status', {
			issueKey,
			eventKind: isCreate ? 'create' : 'move',
			...(isCreate ? {} : { fromStatus: statusChange?.fromString }),
			toStatus: newStatus.name,
			// MNG-1768: surface the locale-invariant status ID so triage can see
			// which side (id vs name) the match resolved against.
			toStatusId: newStatus.id,
			cascadeStatus: matchedCascadeStatus,
			agentType,
		});

		const workItemUrl = `${jiraConfig.baseUrl}/browse/${issueKey}`;
		const workItemTitle = payload.issue?.fields?.summary ?? undefined;

		return buildPMStatusDispatchResult({
			projectId: ctx.project.id,
			agentType,
			workItemId: issueKey,
			workItemUrl,
			workItemTitle,
		});
	}
}
