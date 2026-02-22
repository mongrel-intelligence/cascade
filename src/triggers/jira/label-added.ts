/**
 * JIRA "Ready to Process" label trigger.
 *
 * Fires when the configured readyToProcess label (default: `cascade-ready`) is
 * added to a JIRA issue. Determines which agent to run based on the issue's
 * current status, using the same status→agent mapping as the issue-transitioned
 * trigger.
 *
 * To avoid double-triggering with JiraIssueTransitionedTrigger, this trigger
 * explicitly excludes events that also contain a status change in the changelog.
 */

import {
	resolveJiraTriggerEnabled,
	resolveReadyToProcessEnabled,
} from '../../config/triggerConfig.js';
import { getJiraConfig } from '../../pm/config.js';
import { resolveProjectPMConfig } from '../../pm/lifecycle.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';

interface JiraChangelogItem {
	field?: string;
	fromString?: string;
	toString?: string;
}

interface JiraLabelPayload {
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
		items?: JiraChangelogItem[];
	};
}

/** Same status→agent mapping as issue-transitioned.ts */
const STATUS_TO_AGENT: Record<string, string> = {
	briefing: 'briefing',
	planning: 'planning',
	todo: 'implementation',
};

/**
 * Parse which labels were added from a JIRA label changelog item.
 *
 * JIRA sends label changes as space-separated strings:
 *   fromString: "label-a label-b"
 *   toString:   "label-a label-b label-c"
 *
 * Returns the set of labels present in `toString` but not in `fromString`.
 */
function parseAddedLabels(item: JiraChangelogItem): Set<string> {
	const before = new Set((item.fromString ?? '').split(/\s+/).filter(Boolean));
	const after = (item.toString ?? '').split(/\s+/).filter(Boolean);
	return new Set(after.filter((label) => !before.has(label)));
}

export class JiraReadyToProcessLabelTrigger implements TriggerHandler {
	name = 'jira-ready-to-process-label-added';
	description = 'Triggers agent based on current status when "Ready to Process" label is added';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'jira') return false;

		// Check trigger config — default enabled for backward compatibility
		if (!resolveJiraTriggerEnabled(getJiraConfig(ctx.project)?.triggers, 'readyToProcessLabel')) {
			return false;
		}

		const payload = ctx.payload as JiraLabelPayload;
		if (!payload.webhookEvent?.startsWith('jira:issue_updated')) return false;

		const items = payload.changelog?.items;
		if (!items) return false;

		// Must have a label change
		const labelChange = items.find((item) => item.field === 'labels');
		if (!labelChange) return false;

		// Exclude events that also contain a status change (handled by issue-transitioned trigger)
		const hasStatusChange = items.some((item) => item.field === 'status');
		if (hasStatusChange) return false;

		// Check that the configured readyToProcess label was actually added
		const pmConfig = resolveProjectPMConfig(ctx.project);
		const readyLabel = pmConfig.labels.readyToProcess;
		if (!readyLabel) return false;

		const addedLabels = parseAddedLabels(labelChange);
		return addedLabels.has(readyLabel);
	}

	resolveAgentType(ctx: TriggerContext): string | null {
		const payload = ctx.payload as JiraLabelPayload;
		const currentStatus = payload.issue?.fields?.status?.name;
		if (!currentStatus) return null;

		const jiraConfig = getJiraConfig(ctx.project);
		if (!jiraConfig?.statuses) return null;

		for (const [cascadeStatus, jiraStatus] of Object.entries(jiraConfig.statuses)) {
			if (jiraStatus.toLowerCase() === currentStatus.toLowerCase()) {
				return STATUS_TO_AGENT[cascadeStatus] ?? null;
			}
		}
		return null;
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		const payload = ctx.payload as JiraLabelPayload;
		const issueKey = payload.issue?.key;

		if (!issueKey) {
			return null;
		}

		const currentStatus = payload.issue?.fields?.status?.name;
		if (!currentStatus) {
			logger.debug('No status on JIRA issue, cannot determine agent type', { issueKey });
			return null;
		}

		const jiraConfig = getJiraConfig(ctx.project);
		if (!jiraConfig?.statuses) {
			logger.debug('No JIRA status configuration, skipping label trigger', {
				projectId: ctx.project.id,
			});
			return null;
		}

		// Invert the statuses mapping: find which CASCADE status key maps to this JIRA status
		let agentType: string | undefined;
		for (const [cascadeStatus, jiraStatus] of Object.entries(jiraConfig.statuses)) {
			if (jiraStatus.toLowerCase() === currentStatus.toLowerCase()) {
				agentType = STATUS_TO_AGENT[cascadeStatus];
				break;
			}
		}

		if (!agentType) {
			logger.debug('JIRA issue status does not map to any agent', {
				issueKey,
				currentStatus,
				configuredStatuses: jiraConfig.statuses,
			});
			return null;
		}

		// Check per-agent ready-to-process toggle
		if (!resolveReadyToProcessEnabled(getJiraConfig(ctx.project)?.triggers, agentType)) {
			logger.info('JIRA ready-to-process disabled for agent type, skipping', {
				issueKey,
				agentType,
			});
			return null;
		}

		logger.info('JIRA "Ready to Process" label added, triggering agent', {
			issueKey,
			currentStatus,
			agentType,
		});

		return {
			agentType,
			agentInput: { cardId: issueKey },
			workItemId: issueKey,
		};
	}
}
