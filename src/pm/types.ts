/**
 * PM Provider abstraction — defines the interface that Trello, JIRA, and
 * future project-management integrations must implement.
 */

export type PMType = 'trello' | 'jira';

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
	/** Filter by status name (JIRA: adds status filter to JQL; Trello: ignored since lists are status-scoped) */
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
	listWorkItems(containerId: string, filter?: ListWorkItemsFilter): Promise<WorkItem[]>;

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
}
