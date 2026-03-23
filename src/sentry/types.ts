/**
 * TypeScript types for Sentry webhook payloads and REST API responses.
 *
 * Covers:
 * - Issue alert webhooks (Sentry-Hook-Resource: event_alert)
 * - Metric alert webhooks (Sentry-Hook-Resource: metric_alert)
 * - Issue lifecycle webhooks (Sentry-Hook-Resource: issue)
 * - REST API responses for issues and events
 */

// ============================================================================
// Sentry webhook resource types (Sentry-Hook-Resource header)
// ============================================================================

export type SentryHookResource = 'event_alert' | 'metric_alert' | 'issue' | 'error';

// ============================================================================
// Stack trace types
// ============================================================================

export interface SentryStackFrame {
	filename?: string;
	function?: string;
	lineno?: number;
	colno?: number;
	in_app?: boolean;
	pre_context?: string[];
	context_line?: string;
	post_context?: string[];
	vars?: Record<string, unknown>;
	abs_path?: string;
	module?: string;
}

export interface SentryStackTrace {
	frames?: SentryStackFrame[];
}

export interface SentryException {
	type?: string;
	value?: string;
	stacktrace?: SentryStackTrace;
	mechanism?: { type?: string; handled?: boolean };
}

// ============================================================================
// Breadcrumbs
// ============================================================================

export interface SentryBreadcrumb {
	type?: string;
	category?: string;
	message?: string;
	level?: string;
	timestamp?: string;
	data?: Record<string, unknown>;
}

// ============================================================================
// Sentry event (included in issue alert payloads and REST API responses)
// ============================================================================

export interface SentryEvent {
	event_id?: string;
	url?: string;
	web_url?: string;
	issue_id?: string;
	issue_url?: string;
	project?: string;
	release?: string;
	environment?: string;
	platform?: string;
	message?: string;
	title?: string;
	culprit?: string;
	timestamp?: string;
	received?: string;
	level?: string;
	transaction?: string;
	exception?: {
		values?: SentryException[];
	};
	stacktrace?: SentryStackTrace;
	breadcrumbs?: {
		values?: SentryBreadcrumb[];
	};
	tags?: Array<[string, string]> | Record<string, string>;
	contexts?: Record<string, unknown>;
	request?: {
		url?: string;
		method?: string;
		headers?: Record<string, string>;
		query_string?: string;
	};
	user?: {
		id?: string;
		email?: string;
		username?: string;
		ip_address?: string;
	};
	sdk?: { name?: string; version?: string };
}

// ============================================================================
// Sentry issue (REST API response + webhook data)
// ============================================================================

export interface SentryIssue {
	id: string;
	title: string;
	culprit?: string;
	permalink?: string;
	shortId?: string;
	status?: string;
	substatus?: string;
	issueCategory?: string;
	issueType?: string;
	priority?: string;
	count?: string;
	userCount?: number;
	firstSeen?: string;
	lastSeen?: string;
	project?: { id: string; name: string; slug: string };
	assignedTo?: { name?: string; email?: string } | null;
	isUnhandled?: boolean;
}

// ============================================================================
// Webhook payloads
// ============================================================================

/** Sentry issue alert webhook payload (Sentry-Hook-Resource: event_alert) */
export interface SentryIssueAlertPayload {
	action: 'triggered';
	actor?: { id?: string; type?: string };
	installation?: { uuid?: string };
	data: {
		event: SentryEvent;
		triggered_rule?: string;
		issue_alert?: {
			title?: string;
			settings?: Array<{ name?: string; value?: string }>;
		};
	};
	/** Injected by CASCADE router to identify the project (from URL path param) */
	_cascadeProjectId?: string;
}

/** Sentry metric alert webhook payload (Sentry-Hook-Resource: metric_alert) */
export interface SentryMetricAlertPayload {
	action: 'critical' | 'warning' | 'resolved';
	actor?: { id?: string; type?: string };
	installation?: { uuid?: string };
	data: {
		description_text?: string;
		description_title?: string;
		web_url?: string;
		metric_alert?: {
			alert_rule?: {
				aggregate?: string;
				dataset?: string;
				query?: string;
				thresholds?: Record<string, unknown>;
				triggers?: unknown[];
			};
			status?: string;
			projects?: string[];
			date_created?: string;
			date_detected?: string;
			date_started?: string;
			date_closed?: string | null;
		};
	};
	/** Injected by CASCADE router to identify the project (from URL path param) */
	_cascadeProjectId?: string;
}

/** Sentry issue lifecycle webhook payload (Sentry-Hook-Resource: issue) */
export interface SentryIssuePayload {
	action: 'created' | 'resolved' | 'assigned' | 'archived' | 'unresolved';
	actor?: { id?: string; name?: string; type?: string };
	data: {
		id?: string;
		title?: string;
		url?: string;
		web_url?: string;
		project_url?: string;
		status?: string;
		substatus?: string;
		issueCategory?: string;
		count?: number;
		userCount?: number;
		firstSeen?: string;
		lastSeen?: string;
		assignedTo?: unknown;
	};
	/** Injected by CASCADE router to identify the project (from URL path param) */
	_cascadeProjectId?: string;
}

export type SentryWebhookPayload =
	| SentryIssueAlertPayload
	| SentryMetricAlertPayload
	| SentryIssuePayload;

/** Augmented payload injected by the router (includes resource type and project ID) */
export interface SentryAugmentedPayload {
	resource: SentryHookResource;
	payload: SentryWebhookPayload;
	cascadeProjectId: string;
}
