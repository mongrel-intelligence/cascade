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
	buildChecklistId,
	findChecklistNameByHash,
	hashChecklistItemId,
	parseChecklistId,
	parseInlineChecklists,
	removeChecklistItem,
	toggleChecklistItem,
	upsertChecklistSection,
	upsertItemToChecklist,
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
 * The new contract: after each successful PUT we push a `{before, after}`
 * entry onto a per-issue chain. The next `updateDescription` call compares
 * the live GET result against the full chain:
 *
 *   - GET result === latest `after`  → replica is up to date; no override.
 *   - GET result matches any prior `before` OR any non-latest `after` in the
 *     chain → the replica returned either the stale pre-PUT value OR an
 *     intermediate state where an earlier in-process PUT propagated but a
 *     later one hasn't yet. Substitute the latest `after` as the mutation
 *     base so consecutive in-process updates don't read-modify-write over
 *     each other.
 *   - GET result matches none of the above → the description changed in a
 *     way we didn't author (external edit from another worker or a human).
 *     Use the live value so we don't overwrite concurrent changes.
 *
 * Chain entries are evicted after TTL; the chain is capped at 20 entries per
 * issue so memory is bounded even under heavy mutation bursts.
 *
 * Scope: in-process only. Cross-process races against Linear's eventual
 * consistency are NOT new to this fix and were never solved by the
 * visibility wait — the existing `withDescriptionMutationLock` is
 * process-local too.
 */
const RECENT_DESCRIPTION_TTL_MS = 60_000;
const RECENT_DESCRIPTION_CHAIN_LIMIT = 20;
type RecentDescriptionEntry = { before: string; after: string; timestamp: number };
const recentDescriptions = new Map<string, RecentDescriptionEntry[]>();

function rememberRecentDescription(issueId: string, before: string, after: string): void {
	const chain = recentDescriptions.get(issueId) ?? [];
	chain.push({ before, after, timestamp: Date.now() });
	// Evict expired entries and cap chain length.
	const cutoff = Date.now() - RECENT_DESCRIPTION_TTL_MS;
	recentDescriptions.set(
		issueId,
		chain.filter((e) => e.timestamp >= cutoff).slice(-RECENT_DESCRIPTION_CHAIN_LIMIT),
	);
	// Lazy cleanup of the outer map — keep it small without a setInterval.
	if (recentDescriptions.size > 200) {
		for (const [id, arr] of recentDescriptions.entries()) {
			if (arr.length === 0) recentDescriptions.delete(id);
		}
	}
}

/**
 * Returns the latest cached `after` description when the GET result is
 * demonstrably stale or an intermediate state from our own PUT chain.
 *
 * Returns `undefined` when the GET result is the most-recent PUT (already
 * up to date) or an external edit (unknown description → use live value).
 */
function recallRecentDescription(issueId: string, fetchedDescription: string): string | undefined {
	const chain = recentDescriptions.get(issueId);
	if (!chain || chain.length === 0) return undefined;

	// Evict expired entries.
	const cutoff = Date.now() - RECENT_DESCRIPTION_TTL_MS;
	const fresh = chain.filter((e) => e.timestamp >= cutoff);
	if (fresh.length !== chain.length) recentDescriptions.set(issueId, fresh);
	if (fresh.length === 0) return undefined;

	const latestAfter = fresh[fresh.length - 1].after;

	// Already up to date — no override needed.
	if (fetchedDescription === latestAfter) return undefined;

	// Stale read: matches any previously-known `before` in the chain.
	if (fresh.some((e) => fetchedDescription === e.before)) return latestAfter;

	// Intermediate state: matches a non-latest `after` (an earlier PUT propagated
	// but our most-recent PUT hasn't yet).
	if (fresh.slice(0, -1).some((e) => fetchedDescription === e.after)) return latestAfter;

	// Unknown description — likely an external edit. Use the live GET value.
	return undefined;
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
		await this.updateDescription(workItemId, (desc) => upsertChecklistSection(desc, name, []));
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
			upsertChecklistSection(
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
			return upsertItemToChecklist(desc, checklistName, name, checked);
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

			// Read-after-write consistency: if the GET returned the exact
			// pre-PUT description (demonstrably stale), substitute the cached
			// post-PUT value as the mutation base. If Linear returned anything
			// else — our own most-recent PUT or an external edit — use the live
			// provider value so we don't overwrite concurrent changes.
			const rawDescription = issue.description ?? '';
			const cachedDescription = recallRecentDescription(issueId, rawDescription);
			const baseDescription = cachedDescription !== undefined ? cachedDescription : rawDescription;
			const newDesc = mutate(baseDescription);
			try {
				await linearClient.updateIssue(issueId, { description: newDesc });
				rememberRecentDescription(issueId, rawDescription, newDesc);
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
