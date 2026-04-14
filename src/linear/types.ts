export interface LinearCredentials {
	apiKey: string;
}

export interface LinearUser {
	id: string;
	name: string;
	email: string;
	displayName: string;
	avatarUrl: string | null;
	active: boolean;
}

export interface LinearTeam {
	id: string;
	name: string;
	key: string;
	description: string | null;
}

export interface LinearLabel {
	id: string;
	name: string;
	color: string;
	description: string | null;
}

export interface LinearWorkflowState {
	id: string;
	name: string;
	type: string;
	color: string;
}

export interface LinearIssue {
	id: string;
	identifier: string;
	title: string;
	description: string | null;
	priority: number;
	priorityLabel: string;
	state: LinearWorkflowState;
	team: LinearTeam;
	assignee: LinearUser | null;
	labels: LinearLabel[];
	url: string;
	createdAt: string;
	updatedAt: string;
}

export interface LinearComment {
	id: string;
	body: string;
	user: LinearUser | null;
	createdAt: string;
	updatedAt: string;
	issueId: string;
}

export interface LinearAttachment {
	id: string;
	title: string;
	url: string;
	subtitle: string | null;
	metadata: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface LinearReaction {
	id: string;
	emoji: string;
	user: LinearUser | null;
	createdAt: string;
}

// Input types for mutations

export interface LinearCreateIssueInput {
	title: string;
	description?: string;
	teamId: string;
	parentId?: string;
	assigneeId?: string;
	stateId?: string;
	priority?: number;
	labelIds?: string[];
}

export interface LinearUpdateIssueInput {
	title?: string;
	description?: string;
	assigneeId?: string | null;
	stateId?: string;
	priority?: number;
	labelIds?: string[];
}

// Webhook payload types

export interface LinearWebhookIssueData {
	id: string;
	identifier: string;
	title: string;
	description?: string | null;
	priority: number;
	priorityLabel: string;
	url: string;
	teamId: string;
	stateId: string;
	assigneeId?: string | null;
	labelIds: string[];
	createdAt: string;
	updatedAt: string;
}

export interface LinearWebhookCommentData {
	id: string;
	body: string;
	issueId: string;
	userId: string;
	createdAt: string;
	updatedAt: string;
}

export interface LinearWebhookPayload {
	action: 'create' | 'update' | 'remove';
	type: 'Issue' | 'Comment' | 'IssueLabel' | 'Reaction';
	organizationId: string;
	webhookTimestamp: number;
	data: LinearWebhookIssueData | LinearWebhookCommentData | Record<string, unknown>;
	url: string;
}
