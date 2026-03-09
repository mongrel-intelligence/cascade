/**
 * JIRA status-changed trigger.
 *
 * Fires when a JIRA issue transitions to a configured status that maps to
 * a CASCADE agent type (splitting, planning, implementation).
 */

import { getJiraConfig } from '../../pm/config.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { checkTriggerEnabled } from '../shared/trigger-check.js';
import { type JiraWebhookPayload, STATUS_TO_AGENT } from './types.js';

export class JiraStatusChangedTrigger implements TriggerHandler {
	name = 'jira-status-changed';
	description = 'Triggers agent when a JIRA issue transitions to a configured status';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'jira') return false;

		const payload = ctx.payload as JiraWebhookPayload;
		if (!payload.webhookEvent?.startsWith('jira:issue_updated')) return false;

		// Must have a status change in changelog
		const statusChange = payload.changelog?.items?.find((item) => item.field === 'status');
		return !!statusChange;
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		const payload = ctx.payload as JiraWebhookPayload;
		const issueKey = payload.issue?.key;
		const statusChange = payload.changelog?.items?.find((item) => item.field === 'status');

		if (!issueKey || !statusChange) {
			return null;
		}

		const newStatus = statusChange.toString;
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

		// Find which CASCADE status key maps to this JIRA status
		let agentType: string | undefined;
		for (const [cascadeStatus, jiraStatus] of Object.entries(jiraConfig.statuses)) {
			if (jiraStatus.toLowerCase() === newStatus.toLowerCase()) {
				agentType = STATUS_TO_AGENT[cascadeStatus];
				break;
			}
		}

		if (!agentType) {
			logger.debug('JIRA status transition does not map to any agent', {
				issueKey,
				newStatus,
				configuredStatuses: jiraConfig.statuses,
			});
			return null;
		}

		// Check per-agent toggle for statusChanged via new DB-driven system
		if (!(await checkTriggerEnabled(ctx.project.id, agentType, 'pm:status-changed', this.name))) {
			return null;
		}

		logger.info('JIRA issue transitioned to agent-triggering status', {
			issueKey,
			fromStatus: statusChange.fromString,
			toStatus: newStatus,
			agentType,
		});

		// Capture work item display data from the issue payload
		const workItemUrl = `${jiraConfig.baseUrl}/browse/${issueKey}`;
		const workItemTitle = payload.issue?.fields?.summary ?? undefined;

		return {
			agentType,
			agentInput: { cardId: issueKey, workItemUrl, workItemTitle },
			workItemId: issueKey,
			workItemUrl,
			workItemTitle,
		};
	}
}
