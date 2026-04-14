/**
 * Shared Linear webhook types and constants used across Linear trigger handlers.
 */

// ---------------------------------------------------------------------------
// Webhook Payload
// ---------------------------------------------------------------------------

export interface LinearWebhookIssueTriggerData {
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

export interface LinearWebhookCommentTriggerData {
	id: string;
	body: string;
	issueId: string;
	userId: string;
	createdAt: string;
	updatedAt: string;
	issue?: {
		id: string;
		identifier: string;
		title: string;
		teamId: string;
		url: string;
		stateId: string;
	};
}

export interface LinearWebhookIssueLabelData {
	id: string;
	issueId: string;
	labelId: string;
	label?: {
		id: string;
		name: string;
	};
	issue?: {
		id: string;
		identifier: string;
		title: string;
		teamId: string;
		url: string;
		stateId: string;
	};
	teamId?: string;
}

export interface LinearWebhookTriggerPayload {
	action: 'create' | 'update' | 'remove';
	type: 'Issue' | 'Comment' | 'IssueLabel' | 'Reaction';
	organizationId: string;
	webhookTimestamp: number;
	data:
		| LinearWebhookIssueTriggerData
		| LinearWebhookCommentTriggerData
		| LinearWebhookIssueLabelData
		| Record<string, unknown>;
	url: string;
	/** Present on update events — contains the previous values of changed fields */
	updatedFrom?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maps CASCADE status keys to agent types.
 *
 * Project config maps CASCADE status names to Linear state names, e.g.:
 *   { splitting: "Splitting", planning: "Planning", todo: "To Do" }
 *
 * We invert that mapping at runtime: if the issue transitioned to "Splitting",
 * we look up `splitting` → `splitting` agent.
 */
export const STATUS_TO_AGENT: Record<string, string> = {
	splitting: 'splitting',
	planning: 'planning',
	todo: 'implementation',
	backlog: 'backlog-manager',
};
