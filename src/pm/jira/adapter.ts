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
	ListWorkItemsFilter,
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

/** Partial shape of a JIRA comment from the API */
interface JiraComment {
	id?: string;
	created?: string;
	body?: unknown;
	author?: { accountId?: string; displayName?: string; emailAddress?: string };
}

/** Partial shape of a JIRA issue from search results */
interface JiraSearchIssue {
	key?: string;
	fields?: {
		summary?: string;
		status?: { name?: string };
		labels?: string[];
		subtasks?: JiraSubtask[];
		attachment?: JiraAttachment[];
	};
}

/** Partial shape of a JIRA subtask */
interface JiraSubtask {
	key?: string;
	id?: string;
	fields?: { summary?: string; status?: { name?: string } };
}

/** Partial shape of a JIRA attachment */
interface JiraAttachment {
	id?: string;
	filename?: string;
	content?: string;
	mimeType?: string;
	size?: number;
	created?: string;
}

/** Partial shape of a JIRA transition */
interface JiraTransition {
	id?: string;
	name?: string;
	to?: { name?: string };
}

export class JiraPMProvider implements PMProvider {
	readonly type = 'jira' as const;
	private resolvedSubtaskType: string | null = null;

	constructor(private config: JiraConfig) {}

	private async getSubtaskTypeName(): Promise<string> {
		if (this.config.issueTypes?.subtask) return this.config.issueTypes.subtask;
		if (this.resolvedSubtaskType) return this.resolvedSubtaskType;

		const types = await jiraClient.getIssueTypesForProject(this.config.projectKey);
		const subtaskType = types.find((t) => t.subtask);
		this.resolvedSubtaskType = subtaskType?.name ?? 'Subtask';
		logger.info('Resolved JIRA subtask issue type', { name: this.resolvedSubtaskType });
		return this.resolvedSubtaskType;
	}

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
		return comments.map((c: JiraComment) => ({
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

	async addComment(id: string, text: string): Promise<string> {
		const adfBody = markdownToAdf(text);
		return jiraClient.addComment(id, adfBody);
	}

	async updateComment(id: string, commentId: string, text: string): Promise<void> {
		const adfBody = markdownToAdf(text);
		await jiraClient.updateComment(id, commentId, adfBody);
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

		// Transition to backlog status if configured
		const backlogStatus = this.config.statuses?.backlog;
		if (backlogStatus) {
			try {
				await this.moveWorkItem(key, backlogStatus);
			} catch (err) {
				logger.warn('[JIRA] Failed to transition new issue to backlog status', {
					issueKey: key,
					targetStatus: backlogStatus,
					error: String(err),
				});
			}
		}

		return {
			id: key,
			title: config.title,
			description: config.description ?? '',
			url: this.getWorkItemUrl(key),
			labels: [],
		};
	}

	async listWorkItems(containerId: string, filter?: ListWorkItemsFilter): Promise<WorkItem[]> {
		// containerId is the JIRA project key
		let jql = `project = "${containerId}"`;
		if (filter?.status) {
			jql += ` AND status = "${filter.status}"`;
		}
		jql += ' ORDER BY created DESC';
		const issues = await jiraClient.searchIssues(jql);
		return issues.map((issue: JiraSearchIssue) => ({
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
			(t: JiraTransition) =>
				t.name?.toLowerCase() === destination.toLowerCase() ||
				t.to?.name?.toLowerCase() === destination.toLowerCase() ||
				t.id === destination,
		);
		if (!transition) {
			logger.warn('No JIRA transition found for destination', {
				issueKey: id,
				destination,
				available: transitions.map((t: JiraTransition) => `${t.id}:${t.name}`),
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
		const subtasks = ((issue.fields as JiraSearchIssue['fields'])?.subtasks as JiraSubtask[]) ?? [];
		if (subtasks.length === 0) return [];

		const items: ChecklistItem[] = subtasks.map((st: JiraSubtask) => ({
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

	async addChecklistItem(
		_checklistId: string,
		name: string,
		_checked = false,
		description?: string,
	): Promise<void> {
		// Extract parent issue key from checklistId format: "checklist-PROJ-123-timestamp"
		// or "subtasks-PROJ-123"
		// Use \d{10,} to only strip timestamps (10+ digits), not issue numbers like PROJ-5
		const match = _checklistId.match(/(?:checklist|subtasks)-(.+?)(?:-\d{10,})?$/);
		const parentKey = match?.[1];
		if (!parentKey) {
			throw new Error(`Cannot extract parent issue key from checklist ID: ${_checklistId}`);
		}

		const issueType = await this.getSubtaskTypeName();
		await jiraClient.createIssue({
			project: { key: this.config.projectKey },
			parent: { key: parentKey },
			summary: name,
			issuetype: { name: issueType },
			...(description ? { description: markdownToAdf(description) } : {}),
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

	async deleteChecklistItem(_workItemId: string, checkItemId: string): Promise<void> {
		// checkItemId is a JIRA issue key (subtask)
		try {
			await jiraClient.deleteIssue(checkItemId);
		} catch (error) {
			const is403 =
				error instanceof Error &&
				(error.message.includes('403') || error.message.includes('Forbidden'));
			if (!is403) throw error;

			// Deletion not permitted — transition to a terminal status instead
			logger.info('Delete not permitted, transitioning subtask to terminal status', {
				issueKey: checkItemId,
			});
			const transitions = await jiraClient.getTransitions(checkItemId);
			const terminalNames = ['cancelled', "won't do", 'rejected', 'closed', 'done'];
			let match: JiraTransition | undefined;
			for (const name of terminalNames) {
				match = transitions.find((t: JiraTransition) => {
					const toName = (t.to?.name ?? '').toLowerCase();
					const tName = (t.name ?? '').toLowerCase();
					return toName === name || tName === name;
				});
				if (match) break;
			}
			if (!match?.id) {
				throw new Error(
					`Cannot delete subtask ${checkItemId}: deletion returned 403 and no terminal transition found (available: ${transitions.map((t: JiraTransition) => t.name).join(', ')})`,
				);
			}
			await jiraClient.transitionIssue(checkItemId, match.id);
		}
	}

	async getAttachments(workItemId: string): Promise<Attachment[]> {
		const issue = await jiraClient.getIssue(workItemId);
		const attachments =
			((issue.fields as JiraSearchIssue['fields'])?.attachment as JiraAttachment[]) ?? [];
		return attachments.map((a: JiraAttachment) => ({
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

	async linkPR(workItemId: string, prUrl: string, prTitle: string): Promise<void> {
		await jiraClient.addRemoteLink(workItemId, prUrl, prTitle);
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
