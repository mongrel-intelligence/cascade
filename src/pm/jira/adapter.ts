/**
 * JiraPMProvider — wraps the jiraClient to implement the PMProvider interface.
 *
 * Assumes jiraClient credentials are already in scope via withJiraCredentials().
 */

import { jiraClient } from '../../jira/client.js';
import { captureException } from '../../sentry.js';
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
	upsertItemInChecklist,
} from '../_shared/inline-checklist.js';
import type { ContainerId, LabelId } from '../ids.js';
import { parseContainerId } from '../ids.js';
import { resolveJiraMediaUrls } from '../media.js';
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
import { adfToPlainText, extractAdfMediaNodes, markdownToAdf } from './adf.js';

/**
 * Plan 009/3 narrows a subset of the JIRA adapter's public method
 * parameters to branded IDs (`ContainerId`, `LabelId`) via TypeScript
 * method bivariance. Callers typed as `JiraPMProvider` specifically
 * get compile-time enforcement; callers going through `PMProvider`
 * keep the legacy `string` type (the interface contract is unchanged).
 *
 * `createWorkItem` keeps `CreateWorkItemConfig` because TypeScript
 * enforces invariance on object-property types. Internally the adapter
 * uses `config.containerId` as a JIRA project key — the project-scoped
 * entry point.
 */

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
	/** ISO 8601 last-updated timestamp. JIRA exposes this on the comment payload as `updated`. */
	updated?: string;
	body?: unknown;
	author?: { accountId?: string; displayName?: string; emailAddress?: string };
}

/** Partial shape of a JIRA issue from search results */
interface JiraSearchIssue {
	key?: string;
	fields?: {
		summary?: string;
		description?: unknown;
		status?: { name?: string };
		labels?: string[];
		subtasks?: JiraSubtask[];
		attachment?: JiraAttachment[];
		/** ISO 8601 timestamp of issue creation. JIRA exposes this on `fields.created`. */
		created?: string;
		/** ISO 8601 timestamp of last issue update. JIRA exposes this on `fields.updated`. */
		updated?: string;
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
	/** The *transition* ID (distinct from `to.id`, the target status ID). */
	id?: string;
	name?: string;
	/**
	 * The target status object. `to.id` is the locale-invariant status ID —
	 * the JIRA REST transitions endpoint returns a full status object here.
	 * `to.name` is the localized status name.
	 */
	to?: { id?: string; name?: string };
}

export class JiraPMProvider implements PMProvider {
	readonly type = 'jira' as const;

	constructor(private config: JiraConfig) {}

	async getWorkItem(id: string): Promise<WorkItem> {
		const issue = await jiraClient.getIssue(id);
		const fields = issue.fields ?? {};

		const attachments = (fields as { attachment?: JiraAttachment[] }).attachment ?? [];
		const mediaRefs = extractAdfMediaNodes(fields.description);
		const inlineMedia =
			mediaRefs.length > 0
				? resolveJiraMediaUrls(mediaRefs, attachments, 'description')
				: undefined;

		// MNG-1422: JIRA returns `fields.created` / `fields.updated` as ISO
		// timestamps when those fields are requested (the client requests them
		// by default). Surface them as optional fields without altering
		// existing behavior when the values are missing.
		const created = (fields as { created?: string }).created;
		const updated = (fields as { updated?: string }).updated;

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
			...(inlineMedia !== undefined && inlineMedia.length > 0 ? { inlineMedia } : {}),
			...(created ? { createdAt: created } : {}),
			...(updated ? { updatedAt: updated } : {}),
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
			// JIRA comments carry both `created` and `updated` ISO timestamps.
			// Preserve them on the normalized shape; fall back to `created`
			// for `updatedAt` when JIRA hasn't recorded a separate edit.
			...(c.created ? { createdAt: c.created } : {}),
			...((c.updated ?? c.created) ? { updatedAt: c.updated ?? c.created } : {}),
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
				// Parse at the boundary — backlogStatus comes from the
				// project config's statuses record (always present as a
				// non-empty string when defined).
				await this.moveWorkItem(key, parseContainerId(backlogStatus));
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

	async listWorkItems(
		containerId: ContainerId | undefined,
		filter?: ListWorkItemsFilter,
	): Promise<WorkItem[]> {
		// containerId is the JIRA project key — defaults to config.projectKey.
		const projectKey = containerId ?? this.config.projectKey;
		if (!projectKey) return [];
		let jql = `project = "${projectKey}"`;
		if (filter?.status) {
			// Map CASCADE status key (e.g. 'todo') to the native JIRA status
			// value via config.statuses. Falls through to the literal value when
			// no mapping exists, preserving backwards compat with callers that
			// pass status names directly.
			//
			// MNG-1768: config.statuses values are now status IDs (locale-proof),
			// with names accepted as a legacy fallback. JQL accepts a quoted
			// status ID (`status = "10010"`) just as it accepts a quoted name, so
			// ID-based config values continue to resolve here with no change.
			const native = this.config.statuses?.[filter.status] ?? filter.status;
			jql += ` AND status = "${native}"`;
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
			...(issue.fields?.created ? { createdAt: issue.fields.created } : {}),
			...(issue.fields?.updated ? { updatedAt: issue.fields.updated } : {}),
		}));
	}

	async moveWorkItem(id: string, destination: ContainerId): Promise<void> {
		// `destination` is a JIRA status ID (MNG-1768: locale-invariant) or,
		// for legacy name-based configs, a status name. Find the matching
		// transition.
		const transitions = await jiraClient.getTransitions(id);
		const transition = transitions.find(
			(t: JiraTransition) =>
				// Prefer the locale-invariant target status ID (`to.id`). Note
				// `t.id` is the *transition* ID, distinct from `t.to.id`.
				t.to?.id === destination ||
				t.name?.toLowerCase() === destination.toLowerCase() ||
				t.to?.name?.toLowerCase() === destination.toLowerCase() ||
				t.id === destination,
		);
		if (!transition) {
			const available = transitions.map(
				(t: JiraTransition) => `${t.id}:${t.name} (to ${t.to?.id}:${t.to?.name})`,
			);
			logger.warn('No JIRA transition found for destination', {
				issueKey: id,
				destination,
				available,
			});
			// MNG-1768: make the silent miss loud. A localized / misconfigured
			// account whose transitions never match `destination` is otherwise
			// invisible — this capture surfaces it on the first run. No-op when
			// SENTRY_DSN is unset.
			captureException(new Error('No JIRA transition found for destination'), {
				tags: { jira_transition_not_found: 'true' },
				extra: { issueKey: id, destination, available },
			});
			return;
		}
		await jiraClient.transitionIssue(id, transition.id ?? '');
	}

	async addLabel(id: string, labelName: LabelId): Promise<void> {
		const currentLabels = await jiraClient.getIssueLabels(id);
		if (!currentLabels.includes(labelName)) {
			await jiraClient.updateLabels(id, [...currentLabels, labelName]);
		}
	}

	async removeLabel(id: string, labelName: LabelId): Promise<void> {
		const currentLabels = await jiraClient.getIssueLabels(id);
		const newLabels = currentLabels.filter((l) => l !== labelName);
		if (newLabels.length !== currentLabels.length) {
			await jiraClient.updateLabels(id, newLabels);
		}
	}

	async getChecklists(workItemId: string): Promise<Checklist[]> {
		const issue = await jiraClient.getIssue(workItemId);
		const adfDesc = (issue.fields as JiraSearchIssue['fields'])?.description;
		const markdown = adfDesc ? adfToPlainText(adfDesc) : '';
		const parsed = parseInlineChecklists(markdown);
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
			throw new Error(`Invalid JIRA checklist ID: ${checklistId}`);
		}

		await this.updateDescription(parsed.workItemId, (desc) => {
			const checklistName = findChecklistNameByHash(desc, parsed.nameHash);
			if (!checklistName) {
				throw new Error(`Checklist not found in description: ${checklistId}`);
			}
			return upsertItemInChecklist(desc, checklistName, name, checked);
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
	 * Serialize and read-modify-write the issue description as ADF round-trip.
	 * ADF → markdown → mutate → ADF. Retries once on provider failure.
	 */
	private async updateDescription(
		issueKey: string,
		mutate: (desc: string) => string,
	): Promise<void> {
		await withDescriptionMutationLock('jira', issueKey, () =>
			this.updateDescriptionWithProviderRetry(issueKey, mutate),
		);
	}

	private async updateDescriptionWithProviderRetry(
		issueKey: string,
		mutate: (desc: string) => string,
	): Promise<void> {
		for (let attempt = 0; attempt < 2; attempt++) {
			let issue: Awaited<ReturnType<typeof jiraClient.getIssue>>;
			try {
				issue = await jiraClient.getIssue(issueKey);
			} catch (err) {
				if (attempt === 0) {
					this.logDescriptionRetry(issueKey, err);
					continue;
				}
				throw err;
			}

			const adfDesc = (issue.fields as JiraSearchIssue['fields'])?.description;
			const markdown = adfDesc ? adfToPlainText(adfDesc) : '';
			const newMarkdown = mutate(markdown);
			try {
				await jiraClient.updateIssue(issueKey, {
					description: markdownToAdf(newMarkdown),
				});
				return;
			} catch (err) {
				if (attempt === 0) {
					this.logDescriptionRetry(issueKey, err);
					continue;
				}
				throw err;
			}
		}
	}

	private logDescriptionRetry(issueKey: string, err: unknown): void {
		logger.warn('[JIRA] Description provider update failed; retrying once', {
			issueKey,
			error: String(err),
		});
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
