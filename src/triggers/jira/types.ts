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
			// MNG-1768: `status.id` is the locale-invariant status identity JIRA
			// always sends alongside the localized `status.name`.
			status?: { id?: string; name?: string };
			summary?: string;
		};
	};
	changelog?: {
		items?: Array<{
			field?: string;
			// MNG-1768: `from`/`to` carry the locale-invariant status IDs;
			// `fromString`/`toString` carry the localized status names. JIRA
			// includes all four on a status changelog item.
			from?: string;
			to?: string;
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
