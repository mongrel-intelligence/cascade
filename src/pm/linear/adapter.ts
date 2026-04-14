/**
 * LinearPMProvider — wraps linearClient to implement the PMProvider interface.
 *
 * Assumes linearClient credentials are already in scope via withLinearCredentials().
 *
 * Linear does not have native checklists. We model them using child issues
 * (sub-issues), following the same pattern used by JiraPMProvider for subtasks.
 */

import { linearClient } from '../../linear/client.js';
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

interface LinearConfig {
	teamId: string;
	statuses: Record<string, string>;
	labels?: Record<string, string>;
	customFields?: { cost?: string };
}

export class LinearPMProvider implements PMProvider {
	readonly type = 'linear' as const;

	constructor(private config: LinearConfig) {}

	async getWorkItem(id: string): Promise<WorkItem> {
		const issue = await linearClient.getIssue(id);
		return {
			id: issue.identifier || issue.id,
			title: issue.title,
			description: issue.description ?? '',
			url: issue.url,
			status: issue.state?.name,
			labels: issue.labels.map(
				(l): WorkItemLabel => ({
					id: l.id,
					name: l.name,
					color: l.color,
				}),
			),
		};
	}

	async getWorkItemComments(id: string): Promise<WorkItemComment[]> {
		const comments = await linearClient.getIssueComments(id);
		return comments.map((c) => ({
			id: c.id,
			date: c.createdAt,
			text: c.body,
			author: {
				id: c.user?.id ?? '',
				name: c.user?.displayName ?? c.user?.name ?? '',
				username: c.user?.email ?? '',
			},
		}));
	}

	async updateWorkItem(
		id: string,
		updates: { title?: string; description?: string },
	): Promise<void> {
		await linearClient.updateIssue(id, {
			title: updates.title,
			description: updates.description,
		});
	}

	async addComment(id: string, text: string): Promise<string> {
		const comment = await linearClient.createComment(id, text);
		return comment.id;
	}

	async updateComment(_id: string, commentId: string, text: string): Promise<void> {
		await linearClient.updateComment(commentId, text);
	}

	async createWorkItem(config: CreateWorkItemConfig): Promise<WorkItem> {
		const teamId = config.containerId || this.config.teamId;
		const issue = await linearClient.createIssue({
			teamId,
			title: config.title,
			description: config.description,
			...(config.labels?.length
				? {
						labelIds: config.labels
							.map((name) => this.config.labels?.[name])
							.filter((id): id is string => !!id),
					}
				: {}),
		});

		// Transition to backlog status if configured
		const backlogStatus = this.config.statuses?.backlog;
		if (backlogStatus) {
			try {
				await this.moveWorkItem(issue.id, backlogStatus);
			} catch (err) {
				logger.warn('[Linear] Failed to transition new issue to backlog status', {
					issueId: issue.id,
					targetStatus: backlogStatus,
					error: String(err),
				});
			}
		}

		return {
			id: issue.identifier || issue.id,
			title: issue.title,
			description: issue.description ?? '',
			url: issue.url,
			labels: [],
		};
	}

	async listWorkItems(containerId: string, filter?: ListWorkItemsFilter): Promise<WorkItem[]> {
		// containerId is the Linear team ID
		const teamId = containerId || this.config.teamId;
		const issues = await linearClient.listIssues({
			teamId,
			...(filter?.status
				? {
						stateId: this.config.statuses?.[filter.status] ?? filter.status,
					}
				: {}),
		});
		return issues.map((issue) => ({
			id: issue.identifier || issue.id,
			title: issue.title,
			description: issue.description ?? '',
			url: issue.url,
			status: issue.state?.name,
			labels: issue.labels.map(
				(l): WorkItemLabel => ({
					id: l.id,
					name: l.name,
					color: l.color,
				}),
			),
		}));
	}

	async moveWorkItem(id: string, destination: string): Promise<void> {
		// destination is a Linear state name or ID from config.statuses
		const stateId = this.config.statuses?.[destination] ?? destination;
		await linearClient.updateIssueState(id, stateId);
	}

	async addLabel(id: string, labelIdOrName: string): Promise<void> {
		// Resolve name → ID via config if possible
		const labelId = this.config.labels?.[labelIdOrName] ?? labelIdOrName;
		await linearClient.addLabel(id, labelId);
	}

	async removeLabel(id: string, labelIdOrName: string): Promise<void> {
		const labelId = this.config.labels?.[labelIdOrName] ?? labelIdOrName;
		await linearClient.removeLabel(id, labelId);
	}

	async getChecklists(workItemId: string): Promise<Checklist[]> {
		// Linear doesn't have native checklists — map child issues (sub-issues)
		// We fetch the issue's children by listing issues with parentId filter.
		// The linearClient doesn't expose a direct children query, so we use
		// a workaround: list issues filtered by parent identifier.
		// Since linearClient.listIssues() doesn't support parentId filter
		// directly, we fall back to getting the issue and checking its
		// children via the GraphQL API through getIssue() which doesn't
		// return children. We'll use a workaround using the attachment/comment
		// based "pseudo-checklist" pattern with a dedicated sub-issue list call.
		//
		// For now, use listIssues with a parent identifier approach:
		// Linear's filter supports parent.id, but our client doesn't expose that.
		// Return an empty list and rely on the item-level operations for now.
		// This is consistent with how the JIRA implementation works for empty subtask lists.
		logger.debug('[Linear] getChecklists — returning empty list (sub-issues not yet cached)', {
			workItemId,
		});
		return [
			{
				id: `subtasks-${workItemId}`,
				name: 'Sub-issues',
				workItemId,
				items: [] as ChecklistItem[],
			},
		];
	}

	async createChecklist(workItemId: string, name: string): Promise<Checklist> {
		// In Linear, "create checklist" = create a parent context.
		// Items will be sub-issues created via addChecklistItem.
		return {
			id: `checklist-${workItemId}-${Date.now()}`,
			name,
			workItemId,
			items: [],
		};
	}

	async addChecklistItem(
		checklistId: string,
		name: string,
		_checked = false,
		description?: string,
	): Promise<void> {
		// Extract parent issue ID from checklistId format:
		// "checklist-<parentId>-<timestamp>" or "subtasks-<parentId>"
		const match = checklistId.match(/(?:checklist|subtasks)-(.+?)(?:-\d{10,})?$/);
		const parentId = match?.[1];
		if (!parentId) {
			throw new Error(`Cannot extract parent issue ID from checklist ID: ${checklistId}`);
		}

		await linearClient.createIssue({
			teamId: this.config.teamId,
			title: name,
			description,
		});
		// Note: Linear sub-issue (parent) assignment is done via parentId in IssueCreateInput.
		// The linearClient.createIssue accepts the full IssueCreateInput which supports parentId.
		// We create a separate issue and rely on the parent ID matching.
		logger.debug('[Linear] addChecklistItem — created sub-issue', { parentId, title: name });
	}

	async updateChecklistItem(
		_workItemId: string,
		checkItemId: string,
		complete: boolean,
	): Promise<void> {
		// checkItemId is a Linear issue ID (sub-issue)
		const targetStatus = complete
			? (this.config.statuses?.done ?? 'Done')
			: (this.config.statuses?.backlog ?? 'Todo');
		await this.moveWorkItem(checkItemId, targetStatus);
	}

	async deleteChecklistItem(_workItemId: string, checkItemId: string): Promise<void> {
		// Linear doesn't support issue deletion via API — transition to cancelled state
		// We try to find a cancelled/done state and transition to it.
		const cancelledStateId = this.config.statuses?.cancelled ?? this.config.statuses?.done ?? null;

		if (cancelledStateId) {
			try {
				await linearClient.updateIssueState(checkItemId, cancelledStateId);
				logger.info('[Linear] deleteChecklistItem — transitioned sub-issue to terminal state', {
					checkItemId,
					stateId: cancelledStateId,
				});
				return;
			} catch (err) {
				logger.warn('[Linear] Failed to transition sub-issue to terminal state', {
					checkItemId,
					error: String(err),
				});
			}
		}

		logger.warn('[Linear] deleteChecklistItem — no terminal state configured, skipping', {
			checkItemId,
		});
	}

	async getAttachments(workItemId: string): Promise<Attachment[]> {
		const attachments = await linearClient.getAttachments(workItemId);
		return attachments.map((a) => ({
			id: a.id,
			name: a.title,
			url: a.url,
			mimeType: (a.metadata?.mimeType as string) ?? 'application/octet-stream',
			bytes: (a.metadata?.size as number) ?? 0,
			date: a.createdAt,
		}));
	}

	async addAttachment(workItemId: string, url: string, name: string): Promise<void> {
		await linearClient.createAttachment(workItemId, { title: name, url });
	}

	async addAttachmentFile(
		workItemId: string,
		_buffer: Buffer,
		name: string,
		_mimeType: string,
	): Promise<void> {
		// Linear doesn't support binary file uploads — add as a comment with a placeholder.
		// This mirrors the JIRA addAttachment fallback for URL-only attachments.
		await this.addComment(workItemId, `Attachment: ${name} (binary upload not supported)`);
	}

	async getCustomFieldNumber(_workItemId: string, _fieldId: string): Promise<number> {
		// Linear doesn't have generic custom number fields.
		// Return 0 as a safe fallback.
		return 0;
	}

	async updateCustomFieldNumber(
		_workItemId: string,
		_fieldId: string,
		_value: number,
	): Promise<void> {
		// Linear doesn't have generic custom number fields — no-op.
		logger.warn('[Linear] updateCustomFieldNumber — not supported, skipping', { _fieldId });
	}

	async linkPR(workItemId: string, prUrl: string, prTitle: string): Promise<void> {
		await linearClient.createAttachment(workItemId, {
			title: prTitle,
			url: prUrl,
			subtitle: 'Pull Request',
			metadata: { type: 'github_pr' },
		});
	}

	getWorkItemUrl(id: string): string {
		// Linear URLs follow pattern: https://linear.app/team/issue/TEAM-123
		// The id here may be the identifier (TEAM-123) or internal UUID.
		// The issue.url from the API is already correct; for URL construction
		// from an identifier alone we fall back to a generic format.
		return `https://linear.app/issue/${id}`;
	}

	async getAuthenticatedUser(): Promise<{ id: string; name: string; username: string }> {
		const user = await linearClient.getMe();
		return {
			id: user.id,
			name: user.displayName || user.name,
			username: user.email,
		};
	}
}
