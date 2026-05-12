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
import { withDescriptionMutationLock } from '../_shared/description-mutation-lock.js';
import {
	addItemToChecklist,
	appendChecklistSection,
	buildChecklistId,
	findChecklistNameByHash,
	hashChecklistItemId,
	parseChecklistId,
	parseInlineChecklists,
	removeChecklistItem,
	toggleChecklistItem,
} from '../_shared/inline-checklist.js';
import type { LinearConfig } from '../config.js';
import type { ContainerId, LabelId } from '../ids.js';
import { extractMarkdownImages } from '../media.js';
import type {
	Attachment,
	Checklist,
	ChecklistItemDraft,
	CreateWorkItemConfig,
	ListWorkItemsFilter,
	PMProvider,
	WorkItem,
	WorkItemComment,
	WorkItemLabel,
} from '../types.js';

/**
 * In-process read-after-write cache of recently-PUT issue descriptions.
 *
 * Linear's API is eventually consistent — a GET issued moments after a PUT
 * can return the previous description for seconds. Polling the GET until
 * visibility (the prior approach in commit fad4dda1) was too aggressive
 * (1s timeout) and DOSed itself: planning runs MNG-741 / MNG-736 / MNG-739
 * (2026-05-12) all failed with "Linear description visibility timed out"
 * even though every PUT succeeded on Linear's side.
 *
 * The new contract: after each successful PUT, store the new description
 * here. The next `updateDescription` call consults the cache before
 * mutating — if the GET returned a stale value within the consistency
 * window, the cached value wins. After TTL the entry is evicted and the
 * GET becomes authoritative again.
 *
 * Scope: in-process only. Cross-process races against Linear's eventual
 * consistency are NOT new to this fix and were never solved by the
 * visibility wait — the existing `withDescriptionMutationLock` is
 * process-local too.
 */
const RECENT_DESCRIPTION_TTL_MS = 60_000;
type RecentDescription = { description: string; timestamp: number };
const recentDescriptions = new Map<string, RecentDescription>();

function rememberRecentDescription(issueId: string, description: string): void {
	recentDescriptions.set(issueId, { description, timestamp: Date.now() });
	// Lazy cleanup — keep the map small without a setInterval.
	if (recentDescriptions.size > 200) {
		const cutoff = Date.now() - RECENT_DESCRIPTION_TTL_MS;
		for (const [id, entry] of recentDescriptions.entries()) {
			if (entry.timestamp < cutoff) recentDescriptions.delete(id);
		}
	}
}

function recallRecentDescription(issueId: string): string | undefined {
	const entry = recentDescriptions.get(issueId);
	if (!entry) return undefined;
	if (Date.now() - entry.timestamp > RECENT_DESCRIPTION_TTL_MS) {
		recentDescriptions.delete(issueId);
		return undefined;
	}
	return entry.description;
}

/**
 * Test-only escape hatch — each test starts with an empty cache so module-
 * level state doesn't leak between cases. NOT exported via the public API;
 * called only from `tests/unit/pm/linear/adapter.test.ts`.
 */
export function __resetRecentDescriptionsForTests(): void {
	recentDescriptions.clear();
}
const CASCADE_STATUS_KEYS = new Set([
	'backlog',
	'todo',
	'inProgress',
	'inReview',
	'done',
	'merged',
	'cancelled',
	'canceled',
	'splitting',
	'planning',
	'debug',
	'friction',
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function resolveLinearStatusFilter(
	status: string | undefined,
	configStatuses: LinearConfig['statuses'] | undefined,
): string | null | undefined {
	if (!status) return undefined;
	const mapped = configStatuses?.[status];
	if (mapped) return mapped;
	if (CASCADE_STATUS_KEYS.has(status)) return null;
	return UUID_RE.test(status) ? status : null;
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
		const inlineMedia = extractMarkdownImages(issue.description ?? '', 'description');
		return {
			id: issue.identifier || issue.id,
			title: issue.title,
			description: issue.description ?? '',
			url: issue.url,
			status: issue.state?.name,
			statusId: issue.state?.id,
			labels: issue.labels.map(
				(l): WorkItemLabel => ({
					id: l.id,
					name: l.name,
					color: l.color,
				}),
			),
			inlineMedia: inlineMedia.length > 0 ? inlineMedia : undefined,
		};
	}

	async getWorkItemComments(id: string): Promise<WorkItemComment[]> {
		const comments = await linearClient.getIssueComments(id);
		return comments.map((c) => {
			const inlineMedia = extractMarkdownImages(c.body, 'comment');
			return {
				id: c.id,
				date: c.createdAt,
				text: c.body,
				author: {
					id: c.user?.id ?? '',
					name: c.user?.displayName ?? c.user?.name ?? '',
					username: c.user?.email ?? '',
				},
				inlineMedia: inlineMedia.length > 0 ? inlineMedia : undefined,
			};
		});
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
		containerId: ContainerId | undefined,
		filter?: ListWorkItemsFilter,
	): Promise<WorkItem[]> {
		// containerId is the Linear team ID — defaults to config.teamId.
		const teamId = containerId || this.config.teamId;
		if (!teamId) return [];
		const stateId = resolveLinearStatusFilter(filter?.status, this.config.statuses);
		if (stateId === null) return [];
		const issues = await linearClient.listIssues({
			teamId,
			...(this.config.projectId ? { projectId: this.config.projectId } : {}),
			...(stateId ? { stateId } : {}),
		});
		return issues.map((issue) => ({
			id: issue.identifier || issue.id,
			title: issue.title,
			description: issue.description ?? '',
			url: issue.url,
			status: issue.state?.name,
			statusId: issue.state?.id,
			labels: issue.labels.map(
				(l): WorkItemLabel => ({
					id: l.id,
					name: l.name,
					color: l.color,
				}),
			),
		}));
	}

	async moveWorkItem(id: string, destination: ContainerId): Promise<void> {
		// destination is a Linear state name OR a state ID — per the
		// current contract, callers may pass either. Branded ContainerId
		// on the class-level signature enforces "came through parseContainerId"
		// at direct callers; the resolver still tries config lookup first.
		const stateId = this.config.statuses?.[destination] ?? destination;
		await linearClient.updateIssueState(id, stateId);
	}

	async addLabel(id: string, labelIdOrName: LabelId): Promise<void> {
		const labelId = this.resolveLabelId(labelIdOrName);
		if (!labelId) return;
		await linearClient.addLabel(id, labelId);
	}

	async removeLabel(id: string, labelIdOrName: LabelId): Promise<void> {
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

	async createChecklistWithItems(
		workItemId: string,
		name: string,
		items: ChecklistItemDraft[],
	): Promise<Checklist> {
		await this.updateDescription(workItemId, (desc) =>
			appendChecklistSection(
				desc,
				name,
				items.map((item) => ({ name: item.name, checked: item.checked ?? false })),
			),
		);

		return {
			id: buildChecklistId(workItemId, name),
			name,
			workItemId,
			items: items.map((item) => ({
				id: hashChecklistItemId(name, item.name),
				name: item.name,
				complete: item.checked ?? false,
			})),
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
	 * Serialize and read-modify-write the issue description with one retry on provider failure.
	 * Used by all checklist mutation methods.
	 */
	private async updateDescription(
		issueId: string,
		mutate: (desc: string) => string,
	): Promise<void> {
		await withDescriptionMutationLock('linear', issueId, () =>
			this.updateDescriptionWithProviderRetry(issueId, mutate),
		);
	}

	private async updateDescriptionWithProviderRetry(
		issueId: string,
		mutate: (desc: string) => string,
	): Promise<void> {
		for (let attempt = 0; attempt < 2; attempt++) {
			let issue: Awaited<ReturnType<typeof linearClient.getIssue>>;
			try {
				issue = await linearClient.getIssue(issueId);
			} catch (err) {
				if (attempt === 0) {
					this.logDescriptionRetry(issueId, err);
					continue;
				}
				throw err;
			}

			// Read-after-write consistency: if we recently PUT a newer description
			// for this issue and the GET above returned the stale pre-PUT value
			// (Linear's eventual-consistency window), use the cached fresh value
			// as the source of truth for the mutation. Without this, consecutive
			// in-process updates can read-modify-write over each other.
			const cachedDescription = recallRecentDescription(issueId);
			const baseDescription =
				cachedDescription !== undefined ? cachedDescription : (issue.description ?? '');
			const newDesc = mutate(baseDescription);
			try {
				await linearClient.updateIssue(issueId, { description: newDesc });
				rememberRecentDescription(issueId, newDesc);
				return;
			} catch (err) {
				if (attempt === 0) {
					this.logDescriptionRetry(issueId, err);
					continue;
				}
				throw err;
			}
		}
	}

	private logDescriptionRetry(issueId: string, err: unknown): void {
		logger.warn('[Linear] Description provider update failed; retrying once', {
			issueId,
			error: String(err),
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
