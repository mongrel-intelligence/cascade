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
import { checkTriggerEnabledWithParams } from '../shared/trigger-check.js';
import { type JiraWebhookPayload, STATUS_TO_AGENT } from './types.js';

function isCreateEvent(payload: JiraWebhookPayload): boolean {
	return payload.webhookEvent === 'jira:issue_created';
}

function findStatusChange(
	payload: JiraWebhookPayload,
): { fromString?: string; toString?: string } | undefined {
	return payload.changelog?.items?.find((item) => item.field === 'status');
}

/**
 * Resolve the new status name from a JIRA webhook payload.
 * Returns `undefined` when the status cannot be determined.
 */
function resolveNewStatus(payload: JiraWebhookPayload): string | undefined {
	if (isCreateEvent(payload)) {
		return payload.issue?.fields?.status?.name;
	}
	return findStatusChange(payload)?.toString;
}

function resolveAgentType(
	newStatus: string,
	configStatuses: Record<string, string>,
): string | undefined {
	const lower = newStatus.toLowerCase();
	for (const [cascadeStatus, jiraStatus] of Object.entries(configStatuses)) {
		if (jiraStatus.toLowerCase() === lower) {
			return STATUS_TO_AGENT[cascadeStatus];
		}
	}
	return undefined;
}

function shouldFireOnEvent(isCreate: boolean, parameters: Record<string, unknown>): boolean {
	if (isCreate) return parameters.onCreate === true;
	return parameters.onMove !== false; // default true
}

export class JiraStatusChangedTrigger implements TriggerHandler {
	name = 'jira-status-changed';
	description = 'Triggers agent when a JIRA issue transitions to a configured status';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'jira') return false;

		const payload = ctx.payload as JiraWebhookPayload;

		// Create path: require resolvable status so handle() has something to map
		if (isCreateEvent(payload)) {
			return typeof payload.issue?.fields?.status?.name === 'string';
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

		const agentType = resolveAgentType(newStatus, jiraConfig.statuses);
		if (!agentType) {
			logger.debug('JIRA status transition does not map to any agent', {
				issueKey,
				newStatus,
				configuredStatuses: jiraConfig.statuses,
			});
			return null;
		}

		const { enabled, parameters } = await checkTriggerEnabledWithParams(
			ctx.project.id,
			agentType,
			'pm:status-changed',
			this.name,
		);
		if (!enabled) return null;

		const isCreate = isCreateEvent(payload);
		if (!shouldFireOnEvent(isCreate, parameters)) {
			logger.debug('JIRA status-changed event gated by trigger params', {
				issueKey,
				agentType,
				eventKind: isCreate ? 'create' : 'move',
				parameters,
			});
			return null;
		}

		const statusChange = findStatusChange(payload);
		logger.info('JIRA issue entered agent-triggering status', {
			issueKey,
			eventKind: isCreate ? 'create' : 'move',
			...(isCreate ? {} : { fromStatus: statusChange?.fromString }),
			toStatus: newStatus,
			agentType,
		});

		const workItemUrl = `${jiraConfig.baseUrl}/browse/${issueKey}`;
		const workItemTitle = payload.issue?.fields?.summary ?? undefined;

		return {
			agentType,
			agentInput: {
				workItemId: issueKey,
				workItemUrl,
				workItemTitle,
				triggerEvent: 'pm:status-changed',
			},
			workItemId: issueKey,
			workItemUrl,
			workItemTitle,
		};
	}
}
