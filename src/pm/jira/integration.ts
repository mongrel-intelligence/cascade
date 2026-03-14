/**
 * JiraIntegration — implements PMIntegration for JIRA.
 *
 * Encapsulates all JIRA-specific concerns: credential resolution,
 * webhook parsing, ack comments, reactions, project lookup, and triggers.
 *
 * Router-side operations (ack comments, reactions, bot identity) delegate
 * to the single-source-of-truth functions in router/acknowledgments.ts
 * and router/reactions.ts.
 */

import {
	findProjectById,
	getIntegrationCredential,
	loadProjectConfigByJiraProjectKey,
} from '../../config/provider.js';
import { withJiraCredentials } from '../../jira/client.js';
import {
	deleteJiraAck,
	postJiraAck,
	resolveJiraBotAccountId,
} from '../../router/acknowledgments.js';
import { sendAcknowledgeReaction } from '../../router/reactions.js';
import type { CascadeConfig, ProjectConfig } from '../../types/index.js';
import { getJiraConfig } from '../config.js';
import type { PMIntegration, PMWebhookEvent } from '../integration.js';
import type { ProjectPMConfig } from '../lifecycle.js';
import type { PMProvider } from '../types.js';
import { JiraPMProvider } from './adapter.js';

// JIRA issue key pattern
const JIRA_ISSUE_KEY_REGEX = /\b([A-Z][A-Z0-9]+-\d+)\b/;

export class JiraIntegration implements PMIntegration {
	readonly type = 'jira';

	createProvider(project: ProjectConfig): PMProvider {
		const jiraConfig = getJiraConfig(project);
		if (!jiraConfig?.projectKey) {
			throw new Error('JIRA integration requires projectKey in config');
		}
		return new JiraPMProvider(jiraConfig);
	}

	async withCredentials<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
		const email = await getIntegrationCredential(projectId, 'pm', 'email');
		const apiToken = await getIntegrationCredential(projectId, 'pm', 'api_token');
		const project = await findProjectById(projectId);
		const baseUrl = (project ? getJiraConfig(project)?.baseUrl : undefined) ?? '';
		return withJiraCredentials({ email, apiToken, baseUrl }, fn);
	}

	resolveLifecycleConfig(project: ProjectConfig): ProjectPMConfig {
		const jiraConfig = getJiraConfig(project);
		const jiraLabels = jiraConfig?.labels;
		return {
			labels: {
				processing: jiraLabels?.processing ?? 'cascade-processing',
				processed: jiraLabels?.processed ?? 'cascade-processed',
				error: jiraLabels?.error ?? 'cascade-error',
				readyToProcess: jiraLabels?.readyToProcess ?? 'cascade-ready',
				auto: jiraLabels?.auto ?? 'cascade-auto',
			},
			statuses: {
				backlog: jiraConfig?.statuses?.backlog,
				inProgress: jiraConfig?.statuses?.inProgress,
				inReview: jiraConfig?.statuses?.inReview,
				done: jiraConfig?.statuses?.done,
				merged: jiraConfig?.statuses?.merged,
			},
		};
	}

	parseWebhookPayload(raw: unknown): PMWebhookEvent | null {
		if (!raw || typeof raw !== 'object') return null;
		const p = raw as Record<string, unknown>;
		const webhookEvent = p.webhookEvent as string | undefined;
		if (typeof webhookEvent !== 'string') return null;

		const issue = p.issue as Record<string, unknown> | undefined;
		const issueKey = issue?.key as string | undefined;
		const fields = issue?.fields as Record<string, unknown> | undefined;
		const projectField = fields?.project as Record<string, unknown> | undefined;
		const projectKey = projectField?.key as string | undefined;

		if (!projectKey) return null;

		return {
			eventType: webhookEvent,
			projectIdentifier: projectKey,
			workItemId: issueKey,
			raw,
		};
	}

	async isSelfAuthored(event: PMWebhookEvent, projectId: string): Promise<boolean> {
		if (!event.eventType.startsWith('comment_')) return false;
		const p = event.raw as Record<string, unknown>;
		const comment = p.comment as Record<string, unknown> | undefined;
		const author = comment?.author as Record<string, unknown> | undefined;
		const commentAuthorId = author?.accountId as string | undefined;
		if (!commentAuthorId) return false;

		try {
			const botId = await resolveJiraBotAccountId(projectId);
			return !!botId && commentAuthorId === botId;
		} catch {
			return false;
		}
	}

	async postAckComment(
		projectId: string,
		workItemId: string,
		message: string,
	): Promise<string | null> {
		return postJiraAck(projectId, workItemId, message);
	}

	async deleteAckComment(projectId: string, workItemId: string, commentId: string): Promise<void> {
		return deleteJiraAck(projectId, workItemId, commentId);
	}

	async sendReaction(projectId: string, event: PMWebhookEvent): Promise<void> {
		return sendAcknowledgeReaction('jira', projectId, event.raw);
	}

	async lookupProject(
		identifier: string,
	): Promise<{ project: ProjectConfig; config: CascadeConfig } | null> {
		return (await loadProjectConfigByJiraProjectKey(identifier)) ?? null;
	}

	extractWorkItemId(text: string): string | null {
		const match = text.match(JIRA_ISSUE_KEY_REGEX);
		return match ? match[1] : null;
	}
}
