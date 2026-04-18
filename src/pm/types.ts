/**
 * PM Provider abstraction — defines the interface that Trello, JIRA, and
 * future project-management integrations must implement.
 */

import type { ContainerId, LabelId, StateId } from './ids.js';

export type PMType = 'trello' | 'jira' | 'linear';

// ── Discovery capability type machinery ───────────────────────────────────
// Plan 009/1 introduces an optional `discover?` method on PMProvider that
// providers use to surface teams/boards/labels/states/etc. through a single
// generic tRPC endpoint. The capability union + per-capability input/output
// types give the endpoint discriminated typing; providers opt in by
// declaring `discoveryCapabilities` on their manifest AND implementing
// `discover(capability, args)` on their adapter.

/** Every discovery capability a PM provider may declare support for. */
export type DiscoveryCapability =
	| 'teams'
	| 'boards'
	| 'labels'
	| 'states'
	| 'projects'
	| 'customFields'
	| 'containers'
	| 'currentUser';

/**
 * Per-capability argument shapes. Top-level lookups (teams/boards/projects/
 * containers/currentUser) take an optional or no containerId; nested
 * lookups (labels/states/customFields) require one.
 */
export type DiscoveryArgs<K extends DiscoveryCapability> = K extends 'containers' | 'currentUser'
	? Record<string, never>
	: K extends 'teams' | 'boards' | 'projects'
		? { containerId?: ContainerId }
		: K extends 'labels' | 'states' | 'customFields'
			? { containerId: ContainerId }
			: never;

/** Per-capability result shapes. */
export type DiscoveryResult<K extends DiscoveryCapability> = K extends 'labels'
	? Array<{ id: LabelId; name: string; color?: string }>
	: K extends 'states'
		? Array<{
				id: StateId;
				name: string;
				category: 'todo' | 'in_progress' | 'done' | 'canceled' | 'unknown';
			}>
		: K extends 'customFields'
			? Array<{ id: string; name: string; type: string }>
			: K extends 'teams' | 'boards' | 'containers' | 'projects'
				? // `url` is optional — Trello boards carry a web URL; JIRA/Linear
					// projects/teams may not. Consumers that display a board URL
					// (e.g. the wizard's SearchableSelect `detail` slot) read it
					// when present.
					Array<{ id: ContainerId; name: string; url?: string }>
				: K extends 'currentUser'
					? { id: string; name: string; displayName?: string }
					: never;

/**
 * A reference to an inline media item (image, etc.) embedded in a work item
 * description or comment.
 */
export interface MediaReference {
	/** Public or authenticated URL of the media asset */
	url: string;
	/** MIME type of the media asset (e.g. 'image/png', 'image/jpeg') */
	mimeType: string;
	/** Optional alt text extracted from markdown or the attachment name */
	altText?: string;
	/** Where the reference was found */
	source: 'description' | 'comment' | 'attachment';
}

export interface WorkItem {
	id: string;
	title: string;
	description: string;
	url: string;
	status?: string;
	labels: WorkItemLabel[];
	/** Inline media references parsed from the work item description */
	inlineMedia?: MediaReference[];
}

export interface WorkItemLabel {
	id: string;
	name: string;
	color?: string;
}

export interface WorkItemComment {
	id: string;
	date: string;
	text: string;
	author: {
		id: string;
		name: string;
		username: string;
	};
	/** Inline media references parsed from the comment text */
	inlineMedia?: MediaReference[];
}

export interface Checklist {
	id: string;
	name: string;
	workItemId: string;
	items: ChecklistItem[];
}

export interface ChecklistItem {
	id: string;
	name: string;
	complete: boolean;
}

export interface Attachment {
	id: string;
	name: string;
	url: string;
	mimeType: string;
	bytes: number;
	date: string;
}

export interface CreateWorkItemConfig {
	containerId: string; // Trello listId or JIRA projectKey
	title: string;
	description?: string;
	labels?: string[];
}

/** Optional filters for listWorkItems to enable server-side filtering */
export interface ListWorkItemsFilter {
	/**
	 * CASCADE-canonical status key (e.g. `'backlog'`, `'todo'`, `'inProgress'`).
	 * Each provider maps this through its own config:
	 * - Trello: looks up `config.lists[status]` to find the list ID.
	 * - JIRA: looks up `config.statuses[status]` for the status name in JQL.
	 * - Linear: looks up `config.statuses[status]` for the state UUID.
	 *
	 * Falls through to literal value when no mapping exists (backwards compat).
	 */
	status?: string;
}

export interface PMProvider {
	readonly type: PMType;

	// Core CRUD
	getWorkItem(id: string): Promise<WorkItem>;
	getWorkItemComments(id: string): Promise<WorkItemComment[]>;
	updateWorkItem(id: string, updates: { title?: string; description?: string }): Promise<void>;
	addComment(id: string, text: string): Promise<string>;
	updateComment(id: string, commentId: string, text: string): Promise<void>;
	createWorkItem(config: CreateWorkItemConfig): Promise<WorkItem>;
	/**
	 * List work items in a container (Trello list / JIRA project / Linear team).
	 *
	 * Pass `undefined` for `containerId` to fetch by status — each provider
	 * self-resolves the natural scope from its config: Trello looks up
	 * `lists[filter.status]`, JIRA defaults to `projectKey`, Linear defaults
	 * to `teamId`. Returns `[]` when neither containerId nor a resolvable
	 * scope is available.
	 */
	listWorkItems(containerId: string | undefined, filter?: ListWorkItemsFilter): Promise<WorkItem[]>;

	// Lifecycle
	moveWorkItem(id: string, destination: string): Promise<void>;
	addLabel(id: string, labelIdOrName: string): Promise<void>;
	removeLabel(id: string, labelIdOrName: string): Promise<void>;

	// Checklists
	getChecklists(workItemId: string): Promise<Checklist[]>;
	createChecklist(workItemId: string, name: string): Promise<Checklist>;
	addChecklistItem(
		checklistId: string,
		name: string,
		checked?: boolean,
		description?: string,
	): Promise<void>;
	updateChecklistItem(workItemId: string, checkItemId: string, complete: boolean): Promise<void>;
	deleteChecklistItem(workItemId: string, checkItemId: string): Promise<void>;

	// Attachments & custom fields
	getAttachments(workItemId: string): Promise<Attachment[]>;
	addAttachment(workItemId: string, url: string, name: string): Promise<void>;
	addAttachmentFile(
		workItemId: string,
		buffer: Buffer,
		name: string,
		mimeType: string,
	): Promise<void>;
	getCustomFieldNumber(workItemId: string, fieldId: string): Promise<number>;
	updateCustomFieldNumber(workItemId: string, fieldId: string, value: number): Promise<void>;

	// PR linking
	linkPR(workItemId: string, prUrl: string, prTitle: string): Promise<void>;

	// Utility
	getWorkItemUrl(id: string): string;
	getAuthenticatedUser(): Promise<{ id: string; name: string; username: string }>;

	/**
	 * Optional — generic discovery dispatch. Providers that implement this
	 * method must also declare the corresponding capability flags on their
	 * `PMProviderManifest.discoveryCapabilities`. The `pm.discover` tRPC
	 * endpoint routes to this method; the wizard consumes it through the
	 * generic provider-hooks shell instead of per-provider tRPC procedures.
	 *
	 * Plans 2, 3, 4 migrate Trello, JIRA, and Linear onto this method. While
	 * the method is optional, per-provider method signatures (moveWorkItem,
	 * createWorkItem, etc.) continue to accept plain `string` at the
	 * interface level; adapter implementations narrow to branded types in
	 * their migration plans.
	 */
	discover?<K extends DiscoveryCapability>(
		capability: K,
		args: DiscoveryArgs<K>,
	): Promise<DiscoveryResult<K>>;
}
