/**
 * Per-source format helpers for the alert→PM materializer (spec 019).
 *
 * Each helper converts a provider-specific webhook payload into AlertHints
 * (title + descriptionMarkdown). New sources (PagerDuty, Datadog, etc.) add a
 * new export here; the materializer itself stays unchanged.
 */

import type {
	SentryAugmentedPayload,
	SentryIssueAlertPayload,
	SentryIssuePayload,
	SentryMetricAlertPayload,
	SentryStackFrame,
} from '../../../sentry/types.js';
import type { AlertHints } from './types.js';

export function firstUsefulString(...candidates: unknown[]): string | undefined {
	for (const candidate of candidates) {
		if (typeof candidate !== 'string') continue;
		const trimmed = candidate.trim();
		if (!trimmed) continue;
		if (trimmed === 'undefined' || trimmed === 'null') continue;
		return trimmed;
	}
	return undefined;
}

export function firstUsefulUrl(...candidates: unknown[]): string | undefined {
	return firstUsefulString(...candidates);
}

/** Build the PM card title and description body from a Sentry event_alert payload. */
export function formatSentryCardBody(augmented: SentryAugmentedPayload): AlertHints {
	const payload = augmented.payload as SentryIssueAlertPayload;
	const event = payload.data?.event;

	const alertTitle = firstUsefulString(
		payload.data?.issue_alert?.title,
		payload.data?.triggered_rule,
		event?.title,
		'Issue Alert',
	);

	const issueUrl = firstUsefulUrl(event?.web_url, event?.issue_url) ?? '';
	const timestamp = event?.timestamp ?? '';
	const topFrame = findTopInAppFrame(event?.exception?.values?.[0]?.stacktrace?.frames);

	const lines: string[] = [];

	if (issueUrl) lines.push(`**Sentry issue:** ${issueUrl}`);
	if (timestamp) lines.push(`**First seen:** ${timestamp}`);

	const ruleName = firstUsefulString(
		payload.data?.issue_alert?.title,
		payload.data?.triggered_rule,
	);
	if (ruleName) lines.push(`**Alert rule:** ${ruleName}`);

	if (topFrame) {
		const loc = [topFrame.filename, topFrame.function, topFrame.lineno].filter(Boolean).join(':');
		lines.push(`**Top frame:** \`${loc}\``);
	}

	return {
		title: `[Sentry] ${alertTitle}`,
		descriptionMarkdown: lines.join('\n'),
	};
}

function findTopInAppFrame(frames?: SentryStackFrame[]): SentryStackFrame | undefined {
	if (!frames?.length) return undefined;
	// Prefer the last in-app frame (top of the user call stack)
	for (let i = frames.length - 1; i >= 0; i--) {
		if (frames[i].in_app) return frames[i];
	}
	return frames[frames.length - 1];
}

/**
 * Build the PM card title and description body from a Sentry issue-lifecycle
 * webhook (Sentry-Hook-Resource: issue — the Internal Integration default
 * surface). Distinct from `formatSentryCardBody` (event_alert), which pulls
 * fields from `data.event.{...}` instead of `data.issue.{...}`.
 */
export function formatSentryIssueLifecycleCardBody(augmented: SentryAugmentedPayload): AlertHints {
	const payload = augmented.payload as SentryIssuePayload;
	const issue = payload.data?.issue;

	const alertTitle = firstUsefulString(issue?.title, 'Sentry Issue');
	const issueUrl = firstUsefulUrl(issue?.web_url, issue?.permalink, issue?.url) ?? '';
	const lines: string[] = [];

	if (issueUrl) lines.push(`**Sentry issue:** ${issueUrl}`);
	if (issue?.firstSeen) lines.push(`**First seen:** ${issue.firstSeen}`);
	if (issue?.level) lines.push(`**Level:** ${issue.level}`);
	if (issue?.shortId) lines.push(`**Short ID:** ${issue.shortId}`);
	if (issue?.culprit) lines.push(`**Culprit:** \`${issue.culprit}\``);

	const md = issue?.metadata;
	if (md?.filename || md?.function) {
		const loc = [md.filename, md.function].filter(Boolean).join(':');
		lines.push(`**Top frame:** \`${loc}\``);
	}

	return {
		title: `[Sentry] ${alertTitle}`,
		descriptionMarkdown: lines.join('\n'),
	};
}

/** Build the PM card title and description body from a Sentry metric_alert payload. */
export function formatSentryMetricCardBody(augmented: SentryAugmentedPayload): AlertHints {
	const payload = augmented.payload as SentryMetricAlertPayload;

	const alertTitle = firstUsefulString(
		payload.data?.description_title,
		payload.data?.metric_alert?.alert_rule?.aggregate,
		`Metric Alert (${payload.action})`,
	);

	const webUrl = firstUsefulUrl(payload.data?.web_url) ?? '';
	const action = payload.action;
	const query = payload.data?.metric_alert?.alert_rule?.query;
	const aggregate = payload.data?.metric_alert?.alert_rule?.aggregate;

	const lines: string[] = [];
	if (webUrl) lines.push(`**Sentry alert:** ${webUrl}`);
	if (action) lines.push(`**Status:** ${action}`);
	if (aggregate) lines.push(`**Metric:** ${aggregate}`);
	if (query) lines.push(`**Query:** \`${query}\``);

	return {
		title: `[Sentry Metric] ${alertTitle}`,
		descriptionMarkdown: lines.join('\n'),
	};
}
