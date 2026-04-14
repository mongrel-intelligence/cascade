/**
 * Shared JIRA webhook types and constants used across JIRA trigger handlers.
 */

// ---------------------------------------------------------------------------
// Webhook Payload
// ---------------------------------------------------------------------------

export interface JiraWebhookPayload {
	webhookEvent: string;
	issue?: {
		id?: string;
		key: string;
		fields?: {
			project?: { key?: string };
			status?: { name?: string };
			summary?: string;
		};
	};
	changelog?: {
		items?: Array<{
			field?: string;
			fromString?: string;
			toString?: string;
		}>;
	};
	comment?: {
		id?: string;
		body?: unknown;
		author?: { displayName?: string; accountId?: string };
	};
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export { STATUS_TO_AGENT } from '../shared/status-to-agent.js';
