/**
 * LinearPMProvider — wraps linearClient to implement the PMProvider interface.
 *
 * Assumes linearClient credentials are already in scope via withLinearCredentials().
 *
 * Linear does not have native checklists. We model them as inline markdown
 * checkboxes in the parent issue's description. See `src/pm/_shared/inline-checklist.ts`
 * for the engine, and spec 008 for rationale.
 */

import { resolveLabelId as sharedResolveLabelId } from '../../integrations/pm/_shared/label-id-resolver.js';
import { linearClient } from '../../linear/client.js';
import { logger } from '../../utils/logging.js';
import {
	addItemToChecklist,
	appendChecklistSection,
	findChecklistNameByHash,
	hashChecklistItemId,
	parseInlineChecklists,
	removeChecklistItem,
	toggleChecklistItem,
} from '../_shared/inline-checklist.js';
import type { LinearConfig } from '../config.js';
import type {
	Attachment,
	Checklist,
	CreateWorkItemConfig,
	ListWorkItemsFilter,
	PMProvider,
	WorkItem,
	WorkItemComment,
	WorkItemLabel,
} from '../types.js';

const INLINE_CHECKLIST_ID_PREFIX = 'inline-';

function buildChecklistId(workItemId: string, checklistName: string): string {
	const hash = hashChecklistItemId('', checklistName).slice(3); // strip 'cl-' prefix
	return `${INLINE_CHECKLIST_ID_PREFIX}${workItemId}-${hash}`;
}

function parseChecklistId(checklistId: string): { workItemId: string; nameHash: string } | null {
	if (!checklistId.startsWith(INLINE_CHECKLIST_ID_PREFIX)) return null;
	const rest = checklistId.slice(INLINE_CHECKLIST_ID_PREFIX.length);
	// Last segment is 8-char hex hash; everything before is the workItemId
	const m = rest.match(/^(.+)-([0-9a-f]{8})$/);
	if (!m) return null;
	return { workItemId: m[1], nameHash: m[2] };
}

export class LinearPMProvider implements PMProvider {
	readonly type = 'linear' as const;

	constructor(private config: LinearConfig) {}

	/**
	 * Resolve a label slot name or raw ID to a Linear label UUID.
	 *
	 * Delegates to the shared `_shared/label-id-resolver` helper — single
	 * source of truth for the UUID validation rule. Returns null when the
	 * input cannot be resolved to a UUID; the caller then short-circuits
	 * the label operation with a visible warn.
	 */
	private resolveLabelId(slotOrId: string): string | null {
		return sharedResolveLabelId(
			slotOrId,
			this.config.labels as Record<string, string> | undefined,
			{ providerId: 'linear', extra: { teamId: this.config.teamId } },
		);
	}

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
			...(this.config.projectId ? { projectId: this.config.projectId } : {}),
			title: config.title,
			description: config.description,
			...(this.config.statuses?.backlog ? { stateId: this.config.statuses.backlog } : {}),
			...(config.labels?.length
				? {
						labelIds: config.labels
							.map((name) => this.resolveLabelId(name))
							.filter((id): id is string => id !== null),
					}
				: {}),
		});

		return {
			id: issue.identifier || issue.id,
			title: issue.title,
			description: issue.description ?? '',
			url: issue.url,
			labels: [],
		};
	}

	async listWorkItems(
		containerId: string | undefined,
		filter?: ListWorkItemsFilter,
	): Promise<WorkItem[]> {
		// containerId is the Linear team ID — defaults to config.teamId.
		const teamId = containerId || this.config.teamId;
		if (!teamId) return [];
		const issues = await linearClient.listIssues({
			teamId,
			...(this.config.projectId ? { projectId: this.config.projectId } : {}),
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
		const labelId = this.resolveLabelId(labelIdOrName);
		if (!labelId) return;
		await linearClient.addLabel(id, labelId);
	}

	async removeLabel(id: string, labelIdOrName: string): Promise<void> {
		const labelId = this.resolveLabelId(labelIdOrName);
		if (!labelId) return;
		await linearClient.removeLabel(id, labelId);
	}

	async getChecklists(workItemId: string): Promise<Checklist[]> {
		const issue = await linearClient.getIssue(workItemId);
		const parsed = parseInlineChecklists(issue.description ?? '');
		return parsed.map((c) => ({
			id: buildChecklistId(workItemId, c.name),
			name: c.name,
			workItemId,
			items: c.items.map((i) => ({ id: i.id, name: i.name, complete: i.complete })),
		}));
	}

	async createChecklist(workItemId: string, name: string): Promise<Checklist> {
		await this.updateDescription(workItemId, (desc) => appendChecklistSection(desc, name, []));
		return {
			id: buildChecklistId(workItemId, name),
			name,
			workItemId,
			items: [],
		};
	}

	async addChecklistItem(
		checklistId: string,
		name: string,
		checked = false,
		_description?: string,
	): Promise<void> {
		const parsed = parseChecklistId(checklistId);
		if (!parsed) {
			throw new Error(`Invalid Linear checklist ID: ${checklistId}`);
		}

		await this.updateDescription(parsed.workItemId, (desc) => {
			const checklistName = findChecklistNameByHash(desc, parsed.nameHash);
			if (!checklistName) {
				throw new Error(`Checklist not found in description: ${checklistId}`);
			}
			return addItemToChecklist(desc, checklistName, name, checked);
		});
		logger.debug('[Linear] addChecklistItem — appended inline checkbox', {
			workItemId: parsed.workItemId,
			name,
		});
	}

	async updateChecklistItem(
		workItemId: string,
		checkItemId: string,
		complete: boolean,
	): Promise<void> {
		await this.updateDescription(workItemId, (desc) => {
			const checklists = parseInlineChecklists(desc);
			return toggleChecklistItem(desc, checkItemId, complete, checklists);
		});
	}

	async deleteChecklistItem(workItemId: string, checkItemId: string): Promise<void> {
		await this.updateDescription(workItemId, (desc) => {
			const checklists = parseInlineChecklists(desc);
			return removeChecklistItem(desc, checkItemId, checklists);
		});
	}

	/**
	 * Read-modify-write the issue description with one retry on conflict.
	 * Used by all checklist mutation methods.
	 */
	private async updateDescription(
		issueId: string,
		mutate: (desc: string) => string,
	): Promise<void> {
		try {
			const issue = await linearClient.getIssue(issueId);
			const newDesc = mutate(issue.description ?? '');
			await linearClient.updateIssue(issueId, { description: newDesc });
		} catch (err) {
			logger.warn('[Linear] Description update failed; retrying once', {
				issueId,
				error: String(err),
			});
			const issue = await linearClient.getIssue(issueId);
			const newDesc = mutate(issue.description ?? '');
			await linearClient.updateIssue(issueId, { description: newDesc });
		}
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
