/**
 * Formatting helpers for Sentry API responses.
 * Converts raw API data into human-readable text for agents.
 */

import type {
	SentryBreadcrumb,
	SentryEvent,
	SentryException,
	SentryIssue,
	SentryStackFrame,
} from '../../../sentry/types.js';

// ============================================================================
// Issue formatting
// ============================================================================

export function formatSentryIssue(issue: SentryIssue): string {
	const lines: string[] = [];

	lines.push(`# Issue: ${issue.title}`);
	lines.push('');

	if (issue.shortId) lines.push(`Short ID: ${issue.shortId}`);
	lines.push(`Issue ID: ${issue.id}`);
	if (issue.culprit) lines.push(`Culprit: ${issue.culprit}`);
	if (issue.status)
		lines.push(`Status: ${issue.status}${issue.substatus ? ` (${issue.substatus})` : ''}`);
	if (issue.priority) lines.push(`Priority: ${issue.priority}`);
	if (issue.count) lines.push(`Occurrences: ${issue.count}`);
	if (issue.userCount !== undefined) lines.push(`Affected Users: ${issue.userCount}`);
	if (issue.firstSeen) lines.push(`First Seen: ${issue.firstSeen}`);
	if (issue.lastSeen) lines.push(`Last Seen: ${issue.lastSeen}`);
	if (issue.project) lines.push(`Project: ${issue.project.name} (${issue.project.slug})`);
	if (issue.assignedTo) {
		const a = issue.assignedTo;
		lines.push(`Assigned To: ${a.name ?? a.email ?? 'Unknown'}`);
	}
	if (issue.isUnhandled !== undefined) lines.push(`Unhandled: ${issue.isUnhandled}`);
	if (issue.permalink) {
		lines.push('');
		lines.push(`URL: ${issue.permalink}`);
	}

	return lines.join('\n');
}

// ============================================================================
// Stack frame formatting
// ============================================================================

function formatStackFrame(frame: SentryStackFrame, index: number): string {
	const lines: string[] = [];
	const location = [frame.filename ?? frame.abs_path, frame.lineno].filter(Boolean).join(':');
	const fn = frame.function ?? '<anonymous>';
	const inApp = frame.in_app ? ' [in_app]' : '';

	lines.push(`  Frame ${index}: ${fn}${inApp}`);
	if (location) lines.push(`    at ${location}`);

	// Source context
	if (frame.pre_context?.length) {
		for (const line of frame.pre_context) {
			lines.push(`    | ${line}`);
		}
	}
	if (frame.context_line !== undefined) {
		lines.push(`  > | ${frame.context_line}  ← error here`);
	}
	if (frame.post_context?.length) {
		for (const line of frame.post_context) {
			lines.push(`    | ${line}`);
		}
	}

	// Local variables (if present and non-empty)
	if (frame.vars && Object.keys(frame.vars).length > 0) {
		lines.push(`    Variables: ${JSON.stringify(frame.vars, null, 0).slice(0, 200)}`);
	}

	return lines.join('\n');
}

function formatException(exc: SentryException): string {
	const lines: string[] = [];
	const header = [exc.type, exc.value].filter(Boolean).join(': ');
	if (header) lines.push(`Exception: ${header}`);

	if (exc.mechanism) {
		const handledStr = exc.mechanism.handled === false ? ' (unhandled)' : ' (handled)';
		lines.push(`Mechanism: ${exc.mechanism.type ?? 'generic'}${handledStr}`);
	}

	const frames = exc.stacktrace?.frames;
	if (frames?.length) {
		lines.push('');
		lines.push('Stacktrace (innermost first):');
		// Show frames in reverse (innermost = last frame = most relevant)
		const reversed = [...frames].reverse();
		for (let i = 0; i < reversed.length; i++) {
			lines.push(formatStackFrame(reversed[i], i));
		}
	}

	return lines.join('\n');
}

// ============================================================================
// Breadcrumbs formatting
// ============================================================================

function formatBreadcrumbs(breadcrumbs: SentryBreadcrumb[]): string {
	const lines: string[] = ['Breadcrumbs (most recent last):'];
	// Show last 20 breadcrumbs to avoid overwhelming output
	const recent = breadcrumbs.slice(-20);
	for (const b of recent) {
		const ts = b.timestamp ? (b.timestamp.split('T')[1]?.slice(0, 8) ?? b.timestamp) : '';
		const level = b.level ? `[${b.level}]` : '';
		const cat = b.category ? `(${b.category})` : '';
		const msg = b.message ?? (b.data ? JSON.stringify(b.data).slice(0, 100) : '');
		lines.push(`  ${ts} ${level} ${cat} ${msg}`.trimEnd());
	}
	return lines.join('\n');
}

// ============================================================================
// Full event formatting — broken into section helpers to stay readable
// ============================================================================

function appendEventMeta(lines: string[], event: SentryEvent): void {
	if (event.event_id) lines.push(`Event ID: ${event.event_id}`);
	if (event.timestamp) lines.push(`Timestamp: ${event.timestamp}`);
	if (event.environment) lines.push(`Environment: ${event.environment}`);
	if (event.release) lines.push(`Release: ${event.release}`);
	if (event.platform) lines.push(`Platform: ${event.platform}`);
	if (event.transaction) lines.push(`Transaction: ${event.transaction}`);
	if (event.level) lines.push(`Level: ${event.level}`);
}

function appendEventTags(lines: string[], event: SentryEvent): void {
	const tags = event.tags;
	if (!tags) return;
	const tagPairs = Array.isArray(tags)
		? tags.map(([k, v]) => `${k}=${v}`)
		: Object.entries(tags).map(([k, v]) => `${k}=${v}`);
	if (tagPairs.length > 0) {
		lines.push(`Tags: ${tagPairs.join(', ')}`);
	}
}

function appendEventRequest(lines: string[], event: SentryEvent): void {
	if (!event.request?.url) return;
	lines.push('');
	lines.push('## Request');
	lines.push(`${event.request.method ?? 'GET'} ${event.request.url}`);
	if (event.request.query_string) lines.push(`Query: ${event.request.query_string}`);
}

function appendEventUser(lines: string[], event: SentryEvent): void {
	if (!event.user) return;
	lines.push('');
	lines.push('## User');
	const u = event.user;
	if (u.id) lines.push(`ID: ${u.id}`);
	if (u.email) lines.push(`Email: ${u.email}`);
	if (u.username) lines.push(`Username: ${u.username}`);
	if (u.ip_address) lines.push(`IP: ${u.ip_address}`);
}

function appendEventStacktrace(lines: string[], event: SentryEvent): void {
	const exceptions = event.exception?.values;
	if (exceptions?.length) {
		lines.push('');
		lines.push('## Exception');
		for (const exc of exceptions) {
			lines.push(formatException(exc));
		}
		return;
	}
	// Top-level stacktrace (no exception wrapper)
	if (event.stacktrace?.frames?.length) {
		lines.push('');
		lines.push('## Stacktrace');
		const frames = [...event.stacktrace.frames].reverse();
		for (let i = 0; i < frames.length; i++) {
			lines.push(formatStackFrame(frames[i], i));
		}
	}
}

export function formatSentryEvent(event: SentryEvent): string {
	const lines: string[] = [];

	const title = event.title ?? event.message ?? '(no title)';
	lines.push(`# Alert Event: ${title}`);
	lines.push('');

	appendEventMeta(lines, event);
	appendEventTags(lines, event);
	appendEventRequest(lines, event);
	appendEventUser(lines, event);
	appendEventStacktrace(lines, event);

	const breadcrumbs = event.breadcrumbs?.values;
	if (breadcrumbs?.length) {
		lines.push('');
		lines.push('## Breadcrumbs');
		lines.push(formatBreadcrumbs(breadcrumbs));
	}

	if (event.web_url) {
		lines.push('');
		lines.push(`URL: ${event.web_url}`);
	}

	return lines.join('\n');
}

// ============================================================================
// Event list formatting
// ============================================================================

export function formatSentryEventList(events: SentryEvent[]): string {
	if (events.length === 0) return 'No events found.';

	const lines: string[] = [`${events.length} event(s):`];
	for (const e of events) {
		const ts = e.timestamp ?? e.received ?? '(unknown time)';
		const id = e.event_id ? e.event_id.slice(0, 8) : '(no id)';
		const tx = e.transaction ? ` — ${e.transaction}` : '';
		lines.push(`  [${id}] ${ts}${tx}`);
	}
	return lines.join('\n');
}
