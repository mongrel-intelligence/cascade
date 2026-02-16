/**
 * JiraPMProvider — wraps the jiraClient to implement the PMProvider interface.
 *
 * Assumes jiraClient credentials are already in scope via withJiraCredentials().
 */

import { jiraClient } from '../../jira/client.js';
import { logger } from '../../utils/logging.js';
import type {
	Attachment,
	Checklist,
	ChecklistItem,
	CreateWorkItemConfig,
	PMProvider,
	WorkItem,
	WorkItemComment,
	WorkItemLabel,
} from '../types.js';
import { adfToPlainText, markdownToAdf } from './adf.js';

interface JiraConfig {
	projectKey: string;
	baseUrl: string;
	statuses: Record<string, string>;
	issueTypes?: Record<string, string>;
	customFields?: { cost?: string };
}

export class JiraPMProvider implements PMProvider {
	readonly type = 'jira' as const;

	constructor(private config: JiraConfig) {}

	async getWorkItem(id: string): Promise<WorkItem> {
		const issue = await jiraClient.getIssue(id);
		const fields = issue.fields ?? {};
		return {
			id: issue.key ?? id,
			title: (fields.summary as string) ?? '',
			description: adfToPlainText(fields.description),
			url: this.getWorkItemUrl(issue.key ?? id),
			status: (fields.status as { name?: string })?.name,
			labels: ((fields.labels as string[]) ?? []).map(
				(l): WorkItemLabel => ({
					id: l,
					name: l,
				}),
			),
		};
	}

	async getWorkItemComments(id: string): Promise<WorkItemComment[]> {
		const comments = await jiraClient.getIssueComments(id);
		return comments.map((c: any) => ({
			id: c.id ?? '',
			date: c.created ?? '',
			text: adfToPlainText(c.body),
			author: {
				id: c.author?.accountId ?? '',
				name: c.author?.displayName ?? '',
				username: c.author?.emailAddress ?? '',
			},
		}));
	}

	async updateWorkItem(
		id: string,
		updates: { title?: string; description?: string },
	): Promise<void> {
		await jiraClient.updateIssue(id, {
			summary: updates.title,
			description: updates.description ? markdownToAdf(updates.description) : undefined,
		});
	}

	async addComment(id: string, text: string): Promise<void> {
		const adfBody = markdownToAdf(text);
		await jiraClient.addComment(id, adfBody);
	}

	async createWorkItem(config: CreateWorkItemConfig): Promise<WorkItem> {
		const issueType = this.config.issueTypes?.default ?? 'Task';
		const result = await jiraClient.createIssue({
			project: { key: config.containerId || this.config.projectKey },
			summary: config.title,
			description: config.description ? markdownToAdf(config.description) : undefined,
			issuetype: { name: issueType },
			...(config.labels?.length ? { labels: config.labels } : {}),
		});
		const key = result.key ?? '';
		return {
			id: key,
			title: config.title,
			description: config.description ?? '',
			url: this.getWorkItemUrl(key),
			labels: [],
		};
	}

	async listWorkItems(containerId: string): Promise<WorkItem[]> {
		// containerId is the JIRA project key
		const jql = `project = "${containerId}" ORDER BY created DESC`;
		const issues = await jiraClient.searchIssues(jql);
		return issues.map((issue: any) => ({
			id: issue.key ?? '',
			title: issue.fields?.summary ?? '',
			description: '',
			url: this.getWorkItemUrl(issue.key ?? ''),
			status: issue.fields?.status?.name,
			labels: ((issue.fields?.labels as string[]) ?? []).map(
				(l: string): WorkItemLabel => ({ id: l, name: l }),
			),
		}));
	}

	async moveWorkItem(id: string, destination: string): Promise<void> {
		// destination is a JIRA status name — find the transition ID
		const transitions = await jiraClient.getTransitions(id);
		const transition = transitions.find(
			(t: any) =>
				t.name?.toLowerCase() === destination.toLowerCase() ||
				t.to?.name?.toLowerCase() === destination.toLowerCase() ||
				t.id === destination,
		);
		if (!transition) {
			logger.warn('No JIRA transition found for destination', {
				issueKey: id,
				destination,
				available: transitions.map((t: any) => `${t.id}:${t.name}`),
			});
			return;
		}
		await jiraClient.transitionIssue(id, transition.id ?? '');
	}

	async addLabel(id: string, labelName: string): Promise<void> {
		const currentLabels = await jiraClient.getIssueLabels(id);
		if (!currentLabels.includes(labelName)) {
			await jiraClient.updateLabels(id, [...currentLabels, labelName]);
		}
	}

	async removeLabel(id: string, labelName: string): Promise<void> {
		const currentLabels = await jiraClient.getIssueLabels(id);
		const newLabels = currentLabels.filter((l) => l !== labelName);
		if (newLabels.length !== currentLabels.length) {
			await jiraClient.updateLabels(id, newLabels);
		}
	}

	async getChecklists(workItemId: string): Promise<Checklist[]> {
		// JIRA doesn't have native checklists — map subtasks
		const issue = await jiraClient.getIssue(workItemId);
		const subtasks = (issue.fields as any)?.subtasks ?? [];
		if (subtasks.length === 0) return [];

		const items: ChecklistItem[] = subtasks.map((st: any) => ({
			id: st.key ?? st.id ?? '',
			name: st.fields?.summary ?? '',
			complete: st.fields?.status?.name === 'Done',
		}));

		return [
			{
				id: `subtasks-${workItemId}`,
				name: 'Subtasks',
				workItemId,
				items,
			},
		];
	}

	async createChecklist(workItemId: string, name: string): Promise<Checklist> {
		// In JIRA, "create checklist" = create a parent concept.
		// Items will be subtasks created via addChecklistItem.
		return {
			id: `checklist-${workItemId}-${Date.now()}`,
			name,
			workItemId,
			items: [],
		};
	}

	async addChecklistItem(_checklistId: string, name: string, _checked = false): Promise<void> {
		// Extract parent issue key from checklistId format: "checklist-PROJ-123-timestamp"
		// or "subtasks-PROJ-123"
		const match = _checklistId.match(/(?:checklist|subtasks)-(.+?)(?:-\d+)?$/);
		const parentKey = match?.[1];
		if (!parentKey) {
			logger.warn('Cannot extract parent issue from checklist ID', { checklistId: _checklistId });
			return;
		}

		const issueType = this.config.issueTypes?.subtask ?? 'Sub-task';
		await jiraClient.createIssue({
			project: { key: this.config.projectKey },
			parent: { key: parentKey },
			summary: name,
			issuetype: { name: issueType },
		});
	}

	async updateChecklistItem(
		_workItemId: string,
		checkItemId: string,
		complete: boolean,
	): Promise<void> {
		// checkItemId is a JIRA issue key (subtask)
		const targetStatus = complete ? 'Done' : 'To Do';
		await this.moveWorkItem(checkItemId, targetStatus);
	}

	async getAttachments(workItemId: string): Promise<Attachment[]> {
		const issue = await jiraClient.getIssue(workItemId);
		const attachments = (issue.fields as any)?.attachment ?? [];
		return attachments.map((a: any) => ({
			id: a.id ?? '',
			name: a.filename ?? '',
			url: a.content ?? '',
			mimeType: a.mimeType ?? '',
			bytes: a.size ?? 0,
			date: a.created ?? '',
		}));
	}

	async addAttachment(_workItemId: string, url: string, name: string): Promise<void> {
		// JIRA only supports file uploads for attachments, not URL links.
		// Add as a comment with the link instead.
		await this.addComment(_workItemId, `Attachment: [${name}](${url})`);
	}

	async addAttachmentFile(
		workItemId: string,
		buffer: Buffer,
		name: string,
		_mimeType: string,
	): Promise<void> {
		await jiraClient.addAttachmentFile(workItemId, buffer, name);
	}

	async getCustomFieldNumber(workItemId: string, fieldId: string): Promise<number> {
		const value = await jiraClient.getCustomFieldValue(workItemId, fieldId);
		return typeof value === 'number' ? value : Number.parseFloat(String(value ?? '0'));
	}

	async updateCustomFieldNumber(workItemId: string, fieldId: string, value: number): Promise<void> {
		await jiraClient.updateCustomField(workItemId, fieldId, value);
	}

	getWorkItemUrl(id: string): string {
		return `${this.config.baseUrl}/browse/${id}`;
	}

	async getAuthenticatedUser(): Promise<{ id: string; name: string; username: string }> {
		const user = await jiraClient.getMyself();
		return {
			id: user.accountId ?? '',
			name: user.displayName ?? '',
			username: user.emailAddress ?? '',
		};
	}
}
