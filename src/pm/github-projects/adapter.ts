/**
 * GitHubProjectsPMProvider — implements PMProvider for GitHub Projects v2.
 *
 * Assumes GitHub Projects credentials are already in scope via
 * withGitHubProjectsCredentials().
 */

import {
	addCommentToIssue,
	addContentToProject,
	addLabelsToContent,
	createRepositoryIssue,
	getContentNode,
	getIssueComments,
	getRepositoryId,
	listAllProjectItems,
	moveProjectItemToStatus,
	removeLabelsFromContent,
	resolveContentRepoLabelId,
	resolveProjectItemId,
	updateComment,
} from '../../github-projects/client.js';
import type { GitHubProjectItem } from '../../github-projects/types.js';
import { logger } from '../../utils/logging.js';
import { parseRepoFullName } from '../../utils/repo.js';
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
import type { GitHubProjectsConfig } from '../config.js';
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
} from '../types.js';

function resolveGitHubProjectsStatusFilter(
	status: string | undefined,
	configStatuses: GitHubProjectsConfig['statuses'] | undefined,
): string | null | undefined {
	if (!status) return undefined;
	const mapped = configStatuses?.[status];
	if (mapped) return mapped;
	// Any status without a configured mapping lists nothing (`null`) — a known
	// CASCADE key with no mapping, or an unknown/custom key. GitHub Projects
	// Status *option* IDs are short opaque hashes with no stable prefix (the
	// `PVTSSF_` prefix identifies the single-select *field*, not its options), so
	// a raw option ID can't be distinguished from an unmapped key here — and every
	// caller passes a CASCADE status key, so raw-option-id passthrough is unneeded.
	return null;
}

export class GitHubProjectsPMProvider implements PMProvider {
	readonly type = 'github-projects' as const;

	/**
	 * @param config     the GitHub Projects PM config (project node ID, owner, status map).
	 * @param repoFullName  the project's SCM repository (`owner/repo`), used only by
	 *   `createWorkItem` to create the backing Issue. A GitHub Project can span many
	 *   repos, so there is no repo in the PM config itself — we borrow the project's
	 *   configured SCM repo. Absent ⇒ `createWorkItem` throws with an actionable message.
	 */
	constructor(
		private config: GitHubProjectsConfig,
		private repoFullName?: string,
	) {}

	/**
	 * In-flight de-duplication of full-board fetches, keyed by project node ID.
	 *
	 * GitHub Projects v2 has no server-side field filter, so `listWorkItems({status})`
	 * must page the entire board. The pipeline-capacity gate fires three concurrent
	 * `listWorkItems` calls (todo/inProgress/inReview) per dispatch — without
	 * coalescing that is three full board paginations. Memoizing the in-flight
	 * `listAllProjectItems` promise collapses the concurrent burst into a single
	 * pagination, then clears the entry the moment it settles, so separate
	 * (non-concurrent) capacity checks always re-fetch and never observe a stale board.
	 */
	private readonly inFlightListAll = new Map<string, Promise<GitHubProjectItem[]>>();

	private listAllProjectItemsCoalesced(projectId: string): Promise<GitHubProjectItem[]> {
		const inFlight = this.inFlightListAll.get(projectId);
		if (inFlight) return inFlight;
		const promise = listAllProjectItems(projectId).finally(() => {
			this.inFlightListAll.delete(projectId);
		});
		this.inFlightListAll.set(projectId, promise);
		return promise;
	}

	async getWorkItem(id: string): Promise<WorkItem> {
		// `id` is the content (Issue/PR) node ID used across the github-projects
		// path — resolve the content node directly and read its Status for this
		// project via the content node's `projectItems` connection. (Going through
		// `getProjectItem`, which expects a ProjectV2Item node ID, would never match
		// and would drop `content`.)
		const content = await getContentNode(id, this.config.projectId);

		// Issue/PR bodies are markdown; user-pasted screenshots arrive as
		// `![alt](url)`. Extract them so the shared image pipeline
		// (downloadAndPrepareImages) delivers them to the agent — the same
		// contract Trello/Linear/JIRA adapters follow (spec 016).
		const inlineMedia = extractMarkdownImages(content.body ?? '', 'description');

		return {
			id,
			title: content.title,
			description: content.body ?? '',
			url: content.url,
			// GitHub Projects single-select value exposes the stable option ID via
			// `optionId`; that is what maps to configured status IDs.
			status: content.statusName,
			statusId: content.statusOptionId,
			// Label *reads* are intentionally unimplemented for github-projects:
			// this is always `[]` even when the backing Issue/PR carries labels.
			// Label *writes* (addLabel / removeLabel) do work. Any agent/lifecycle
			// code that inspects `workItem.labels` will therefore see none here.
			// Tracked in the parity table in docs/architecture/06-integration-layer.md.
			labels: [],
			inlineMedia: inlineMedia.length > 0 ? inlineMedia : undefined,
		};
	}

	async getWorkItemComments(id: string): Promise<WorkItemComment[]> {
		// `id` is the content node ID (Issue/PR), which the GraphQL `node(id)`
		// query resolves to the underlying Issue/PullRequest — so we can read its
		// comments directly. Comment bodies are markdown; user-pasted screenshots
		// arrive as `![alt](url)` and must reach the shared image pipeline, matching
		// the Trello/Linear/JIRA contract (spec 016).
		const comments = await getIssueComments(id);
		return comments.map((c) => {
			const inlineMedia = extractMarkdownImages(c.body, 'comment');
			return {
				id: c.id,
				date: c.createdAt,
				text: c.body,
				author: {
					id: c.author?.id ?? '',
					name: c.author?.name ?? c.author?.login ?? '',
					username: c.author?.login ?? '',
				},
				inlineMedia: inlineMedia.length > 0 ? inlineMedia : undefined,
				...(c.createdAt ? { createdAt: c.createdAt } : {}),
				...(c.updatedAt ? { updatedAt: c.updatedAt } : {}),
			};
		});
	}

	/**
	 * Update the title of an Issue or Pull Request.
	 */
	private async updateContentTitle(contentId: string, title: string, isPR: boolean): Promise<void> {
		const issueMutation = `
			mutation UpdateIssueTitle($id: ID!, $title: String!) {
				updateIssue(input: { id: $id, title: $title }) {
					issue { id }
				}
			}
		`;
		const prMutation = `
			mutation UpdatePullRequestTitle($id: ID!, $title: String!) {
				updatePullRequest(input: { id: $id, title: $title }) {
					pullRequest { id }
				}
			}
		`;
		const { githubGraphQL } = await import('../../github-projects/client.js');
		await githubGraphQL(isPR ? prMutation : issueMutation, { id: contentId, title });
	}

	/**
	 * Update the body/description of an Issue or Pull Request.
	 */
	private async updateContentBody(contentId: string, body: string, isPR: boolean): Promise<void> {
		const issueMutation = `
			mutation UpdateIssueBody($id: ID!, $body: String!) {
				updateIssue(input: { id: $id, body: $body }) {
					issue { id }
				}
			}
		`;
		const prMutation = `
			mutation UpdatePullRequestBody($id: ID!, $body: String!) {
				updatePullRequest(input: { id: $id, body: $body }) {
					pullRequest { id }
				}
			}
		`;
		const { githubGraphQL } = await import('../../github-projects/client.js');
		await githubGraphQL(isPR ? prMutation : issueMutation, { id: contentId, body });
	}

	async updateWorkItem(
		id: string,
		updates: { title?: string; description?: string },
	): Promise<void> {
		// `id` is the content (Issue/PR) node ID; resolve the node to pick the
		// correct update mutation (Issue vs PullRequest).
		const content = await getContentNode(id);
		const isPR = content.type === 'pull_request';

		if (updates.title !== undefined) {
			await this.updateContentTitle(content.id, updates.title, isPR);
		}

		if (updates.description !== undefined) {
			await this.updateContentBody(content.id, updates.description, isPR);
		}
	}

	async addComment(id: string, text: string): Promise<string> {
		// `id` is the content (Issue/PR) node ID — `addComment`'s subjectId is an
		// Issue/PR node, so comment on it directly (no ProjectV2Item lookup needed).
		return addCommentToIssue(id, text);
	}

	async updateComment(_id: string, commentId: string, text: string): Promise<void> {
		await updateComment(commentId, text);
	}

	async createWorkItem(config: CreateWorkItemConfig): Promise<WorkItem> {
		// GitHub Projects has no first-class "create item" that yields a commentable,
		// labelable work item — a real Issue is created in the project's repository
		// and then added to the board. Keeping the content (Issue) node ID as the
		// work-item identity means comments, labels, checklists, and status moves all
		// work afterward. Draft issues are intentionally NOT used: they cannot receive
		// comments or labels, which the friction/alert materializer and agents need.
		if (!this.repoFullName) {
			throw new Error(
				'Creating GitHub Projects work items requires the project to have an SCM repository ' +
					'configured (owner/repo). Set the project repository, or file the item manually.',
			);
		}
		const { owner, repo } = parseRepoFullName(this.repoFullName);
		const repositoryId = await getRepositoryId(owner, repo);
		const issue = await createRepositoryIssue(repositoryId, config.title, config.description ?? '');

		// Add the new Issue to the target project (containerId is the project node ID;
		// fall back to the configured project when the caller passes an empty value).
		const projectId = config.containerId || this.config.projectId;
		await addContentToProject(projectId, issue.id);

		// Apply any requested labels — resolved against the Issue's own repo by addLabel.
		for (const label of config.labels ?? []) {
			await this.addLabel(issue.id, label as LabelId);
		}

		return {
			id: issue.id,
			title: config.title,
			description: config.description ?? '',
			url: issue.url,
			labels: [],
		};
	}

	async listWorkItems(
		containerId: ContainerId | undefined,
		filter?: ListWorkItemsFilter,
	): Promise<WorkItem[]> {
		const projectId = (containerId as string | undefined) ?? this.config.projectId;
		if (!projectId) return [];

		// Maps a CASCADE status key to the GitHub Status *option* ID:
		//  - a string → keep only items whose Status field value has that optionId
		//  - null     → status has no configured mapping → nothing to list
		//  - undefined → no status filter → list every item
		const statusOptionId = resolveGitHubProjectsStatusFilter(filter?.status, this.config.statuses);
		if (statusOptionId === null) return [];

		// GitHub Projects v2 exposes no server-side field filter, so we fetch the
		// project's items and filter by Status option ID client-side. The fetch is
		// coalesced so the capacity gate's concurrent todo/inProgress/inReview burst
		// pages the board once instead of three times (see listAllProjectItemsCoalesced).
		const items = await this.listAllProjectItemsCoalesced(projectId);

		const result: WorkItem[] = [];
		for (const item of items) {
			const content = item.content;
			// Draft issues (no linked Issue/PR) have no content — skip them.
			if (!content?.id) continue;

			const statusField = item.fieldValues?.nodes.find((fv) => fv.field?.name === 'Status');

			if (statusOptionId !== undefined && statusField?.optionId !== statusOptionId) {
				continue;
			}

			result.push({
				// Use the content node ID (Issue/PR) as the identity, matching the
				// `content_node_id` convention used by the trigger/router/lock/ack —
				// so the pipeline-capacity gate's `excludeWorkItemId` filter matches.
				id: content.id,
				title: content.title,
				description: content.body ?? '',
				url: content.url,
				status: statusField?.name,
				statusId: statusField?.optionId,
				// Label reads are unimplemented (always `[]`); see getWorkItem.
				labels: [],
			});
		}
		return result;
	}

	async moveWorkItem(id: string, destination: ContainerId): Promise<void> {
		const statusId = this.config.statuses?.[destination] ?? destination;
		// Status writes target the ProjectV2Item node, but the work-item ID carried
		// across the github-projects path (webhooks, lifecycle, materializer) is the
		// *content* (Issue/PR) node ID. Resolve the item ID for the configured project
		// first; a value already shaped like a ProjectV2Item ID (PVTI_…) is used directly.
		const itemId = String(id).startsWith('PVTI_')
			? id
			: await resolveProjectItemId(id, this.config.projectId);
		if (!itemId) {
			throw new Error(
				`GitHub Projects item not found for content ${id} in project ${this.config.projectId}`,
			);
		}
		await moveProjectItemToStatus(this.config.projectId, itemId, statusId);
	}

	async addLabel(id: string, labelIdOrName: LabelId): Promise<void> {
		const labelId = await this.resolveLabelNodeId(id, labelIdOrName);
		if (!labelId) return;
		await addLabelsToContent(id, [labelId]);
	}

	async removeLabel(id: string, labelIdOrName: LabelId): Promise<void> {
		const labelId = await this.resolveLabelNodeId(id, labelIdOrName);
		if (!labelId) return;
		await removeLabelsFromContent(id, [labelId]);
	}

	/**
	 * Resolve a configured label value to a repo-scoped label node ID for the
	 * Issue/PR behind `contentId`. Config values are treated as label *names*
	 * (the natural, discovery-free choice for GitHub, matching JIRA); a value
	 * that is already a GitHub label node ID (`LA_…`) is used directly. Returns
	 * `null` (and warns) when the content's repository has no such label — the
	 * label operation is then skipped rather than throwing.
	 */
	private async resolveLabelNodeId(
		contentId: string,
		labelIdOrName: LabelId,
	): Promise<string | null> {
		const value = String(labelIdOrName);
		if (!value) return null;
		// GitHub label node IDs are opaque and prefixed `LA_`; use them directly.
		if (value.startsWith('LA_')) return value;

		const labelId = await resolveContentRepoLabelId(contentId, value);
		if (!labelId) {
			logger.warn('[GitHubProjects] label not found in the content repository; skipping', {
				contentId,
				label: value,
			});
			return null;
		}
		return labelId;
	}

	// ---------------------------------------------------------------------------
	// Checklists — inline markdown task lists in the Issue/PR body.
	//
	// GitHub Projects v2 has no native checklist primitive, but GitHub renders
	// markdown task lists (`- [ ]` / `- [x]`) natively, so we reuse the same
	// shared inline-checklist engine Linear and JIRA use — `### {name}` heading +
	// checkbox rows in the content body (spec 008). `workItemId` here is the
	// content (Issue/PR) node ID used across the github-projects path.
	// ---------------------------------------------------------------------------

	async getChecklists(workItemId: string): Promise<Checklist[]> {
		const content = await getContentNode(workItemId);
		const parsed = parseInlineChecklists(content.body ?? '');
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
			throw new Error(`Invalid GitHub Projects checklist ID: ${checklistId}`);
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
	 * Serialize a read-modify-write of the content (Issue/PR) body under the
	 * shared description-mutation lock, so concurrent `cascade-tools pm
	 * update-checklist-item` processes can't clobber each other's body snapshot.
	 * GitHub body is plain markdown (no ADF round-trip) and `updateIssue`/
	 * `updatePullRequest` are strongly consistent, so no sidecar/recent-cache
	 * dance is needed (unlike Linear).
	 */
	private async updateDescription(
		contentId: string,
		mutate: (desc: string) => string,
	): Promise<void> {
		await withDescriptionMutationLock('github-projects', contentId, async () => {
			const content = await getContentNode(contentId);
			const isPR = content.type === 'pull_request';
			const markdown = content.body ?? '';
			const newMarkdown = mutate(markdown);
			if (newMarkdown === markdown) return;
			await this.updateContentBody(content.id, newMarkdown, isPR);
		});
	}

	async getAttachments(_workItemId: string): Promise<Attachment[]> {
		return [];
	}

	async addAttachment(_workItemId: string, _url: string, _name: string): Promise<void> {
		logger.warn('[GitHubProjects] addAttachment not implemented');
	}

	async addAttachmentFile(
		_workItemId: string,
		_buffer: Buffer,
		_name: string,
		_mimeType: string,
	): Promise<void> {
		logger.warn('[GitHubProjects] addAttachmentFile not implemented');
	}

	async getCustomFieldNumber(_workItemId: string, _fieldId: string): Promise<number> {
		return 0;
	}

	async updateCustomFieldNumber(
		_workItemId: string,
		fieldId: string,
		_value: number,
	): Promise<void> {
		logger.warn('[GitHubProjects] updateCustomFieldNumber not implemented', { fieldId });
	}

	async linkPR(_workItemId: string, _prUrl: string, _prTitle: string): Promise<void> {
		// PR linking is implicit when a PR is added to a GitHub Project.
		logger.debug('[GitHubProjects] linkPR is a no-op; PRs are linked by being in the project');
	}

	getWorkItemUrl(_id: string): string {
		// The work-item identity carried across the github-projects path is the
		// opaque *content* (Issue/PR) node ID, which cannot be turned into an
		// item-specific URL synchronously; the project's numeric `number` (needed
		// for a `/projects/<n>` deep link) is not persisted in config either.
		// Every WorkItem-producing method (getWorkItem / listWorkItems /
		// createWorkItem) already carries the accurate Issue/PR `content.url`, and
		// every fallback-style caller prefers it (`workItem.url || getWorkItemUrl`).
		// So this fallback returns a correctly-shaped, resolving owner Projects URL
		// (with the required `users`/`orgs` segment) instead of the previous
		// non-resolving `github.com/<owner>/projects/<PVT_ node id>` string.
		const ownerSegment = this.config.ownerType === 'organization' ? 'orgs' : 'users';
		return `https://github.com/${ownerSegment}/${this.config.owner}/projects`;
	}

	async getAuthenticatedUser(): Promise<{ id: string; name: string; username: string }> {
		const { getViewer } = await import('../../github-projects/client.js');
		const me = await getViewer();
		return {
			id: me.id,
			name: me.name ?? me.login,
			username: me.login,
		};
	}
}
