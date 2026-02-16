/**
 * JIRA issue-transitioned trigger.
 *
 * Fires when a JIRA issue transitions to a configured status that maps to
 * a CASCADE agent type (briefing, planning, implementation).
 */

import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';

interface JiraWebhookPayload {
	webhookEvent: string;
	issue?: {
		key: string;
		fields?: {
			project?: { key?: string };
			status?: { name?: string };
			summary?: string;
		};
	};
	changelog?: {
		items?: Array<{
			field?: string;
			fromString?: string;
			toString?: string;
		}>;
	};
}

/**
 * Maps a JIRA status name to the CASCADE agent type based on project config.
 *
 * project.jira.statuses maps CASCADE status names to JIRA status names, e.g.:
 *   { briefing: "Briefing", planning: "Planning", todo: "To Do" }
 *
 * We invert this mapping: if the issue transitioned to "Briefing", we fire
 * the briefing agent.
 */
const STATUS_TO_AGENT: Record<string, string> = {
	briefing: 'briefing',
	planning: 'planning',
	todo: 'implementation',
};

export class JiraIssueTransitionedTrigger implements TriggerHandler {
	name = 'jira-issue-transitioned';
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

		const jiraConfig = ctx.project.jira;
		if (!jiraConfig?.statuses) {
			logger.debug('No JIRA status configuration, skipping issue transition trigger', {
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

		logger.info('JIRA issue transitioned to agent-triggering status', {
			issueKey,
			fromStatus: statusChange.fromString,
			toStatus: newStatus,
			agentType,
		});

		return {
			agentType,
			agentInput: { cardId: issueKey },
			workItemId: issueKey,
			cardId: issueKey,
		};
	}
}
