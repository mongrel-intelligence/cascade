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

/**
 * Maps CASCADE status keys to agent types.
 *
 * Project config maps CASCADE status names to JIRA status names, e.g.:
 *   { briefing: "Briefing", planning: "Planning", todo: "To Do" }
 *
 * We invert that mapping at runtime: if the issue transitioned to "Briefing",
 * we look up `briefing` → `briefing` agent.
 */
export const STATUS_TO_AGENT: Record<string, string> = {
	briefing: 'briefing',
	planning: 'planning',
	todo: 'implementation',
};
