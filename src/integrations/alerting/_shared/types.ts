/**
 * Shared types for the alert→PM materializer pipeline (spec 019).
 *
 * AlertSource: string union of supported alert origins. Add new source literals
 * here as new alert integrations are built (PagerDuty, Datadog, GitHub Alerts).
 * The materializer itself is source-agnostic — only format helpers are per-source.
 *
 * AlertHints: the source-specific formatter's output. Consumed by the materializer
 * to populate the PM work item's title and description.
 *
 * AlertSlotMissingError: thrown by materializeAlertWorkItem when the project's PM
 * config has no `alerts` slot configured. The trigger handler should catch this and
 * log a WARN, not retry (it is a configuration error, not a transient failure).
 *
 * MaterializationRetryExhausted: thrown when a concurrent claim's winner row never
 * gets its work_item_id populated within the polling budget. The trigger should
 * propagate this so BullMQ retries the job.
 */

/**
 * All supported alert source identifiers. Extend this union as new sources are added.
 *
 * Sentry has three surfaces, each given a distinct literal so the
 * `(project_id, external_source, external_id)` partial-unique index on
 * `pr_work_items` doesn't collide across surfaces (e.g. the same Sentry issue
 * arriving via both `event_alert` and `issue` materializes two cards):
 *   - `'sentry'`        — event_alert (Sentry Alert Rule firings)
 *   - `'sentry-metric'` — metric_alert (metric-based alert rules)
 *   - `'sentry-issue'`  — issue lifecycle (Internal Integration default surface)
 */
export type AlertSource =
	| 'sentry'
	| 'sentry-metric'
	| 'sentry-issue'
	| 'pagerduty'
	| 'datadog'
	| 'github-alert';

/** Formatted card content produced by a per-source format helper. */
export interface AlertHints {
	title: string;
	descriptionMarkdown: string;
}

/** Thrown when the project has no `alerts` slot configured in its PM config. */
export class AlertSlotMissingError extends Error {
	constructor(projectId: string, pmType: string | undefined) {
		super(
			`Project ${projectId} (pm.type=${pmType ?? 'unknown'}) has no 'alerts' slot configured. ` +
				`Set lists.alerts (Trello) or statuses.alerts (JIRA, Linear) in the PM integration config.`,
		);
		this.name = 'AlertSlotMissingError';
	}
}

/** Thrown when polling for a concurrent materializer winner exceeds the retry budget. */
export class MaterializationRetryExhausted extends Error {
	constructor(projectId: string, source: AlertSource, externalId: string) {
		super(
			`[alert-materializer] retry budget exhausted waiting for concurrent winner ` +
				`(project=${projectId}, source=${source}, externalId=${externalId})`,
		);
		this.name = 'MaterializationRetryExhausted';
	}
}
