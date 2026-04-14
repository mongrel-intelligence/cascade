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

export { STATUS_TO_AGENT } from '../shared/status-to-agent.js';
