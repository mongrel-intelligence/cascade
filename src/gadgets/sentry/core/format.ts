/**
 * Formatting helpers for Sentry API responses.
 * Converts raw API data into human-readable text for agents.
 */

import type {
	SentryBreadcrumb,
	SentryEvent,
	SentryException,
	SentryIssue,
	SentryRequest,
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
	const lineno = frame.lineno ?? frame.lineNo;
	const location = [frame.filename ?? frame.abs_path ?? frame.absPath, lineno]
		.filter(Boolean)
		.join(':');
	const fn = frame.function ?? '<anonymous>';
	const inApp = (frame.in_app ?? frame.inApp) ? ' [in_app]' : '';

	lines.push(`  Frame ${index}: ${fn}${inApp}`);
	if (location) lines.push(`    at ${location}`);

	// Source context
	const sourceContext = normalizeFrameSourceContext(frame);
	if (sourceContext.pre.length) {
		for (const line of sourceContext.pre) {
			lines.push(`    | ${line}`);
		}
	}
	if (sourceContext.current !== undefined) {
		lines.push(`  > | ${sourceContext.current}  ← error here`);
	}
	if (sourceContext.post.length) {
		for (const line of sourceContext.post) {
			lines.push(`    | ${line}`);
		}
	}

	// Local variables (if present and non-empty)
	if (frame.vars && Object.keys(frame.vars).length > 0) {
		lines.push(`    Variables: ${JSON.stringify(frame.vars, null, 0).slice(0, 200)}`);
	}

	return lines.join('\n');
}

function normalizeFrameSourceContext(frame: SentryStackFrame): {
	pre: string[];
	current?: string;
	post: string[];
} {
	if (frame.pre_context?.length || frame.context_line !== undefined || frame.post_context?.length) {
		return {
			pre: frame.pre_context ?? [],
			current: frame.context_line,
			post: frame.post_context ?? [],
		};
	}

	if (!frame.context?.length) {
		return { pre: [], post: [] };
	}

	const lineNo = frame.lineno ?? frame.lineNo;
	const currentIndex =
		lineNo === undefined
			? -1
			: frame.context.findIndex(([contextLineNo]) => contextLineNo === lineNo);
	if (currentIndex < 0) {
		return { pre: frame.context.map(([, line]) => line), post: [] };
	}

	return {
		pre: frame.context.slice(0, currentIndex).map(([, line]) => line),
		current: frame.context[currentIndex][1],
		post: frame.context.slice(currentIndex + 1).map(([, line]) => line),
	};
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
	const eventId = getEventId(event);
	const timestamp = getEventTimestamp(event);
	const release = getReleaseValue(event.release);
	if (eventId) lines.push(`Event ID: ${eventId}`);
	if (timestamp) lines.push(`Timestamp: ${timestamp}`);
	if (event.environment) lines.push(`Environment: ${event.environment}`);
	if (release) lines.push(`Release: ${release}`);
	if (event.platform) lines.push(`Platform: ${event.platform}`);
	if (event.transaction) lines.push(`Transaction: ${event.transaction}`);
	if (event.level) lines.push(`Level: ${event.level}`);
}

function appendEventTags(lines: string[], event: SentryEvent): void {
	const tagPairs = normalizeTagPairs(event.tags).map(([key, value]) => `${key}=${value}`);
	if (tagPairs.length > 0) {
		lines.push(`Tags: ${tagPairs.join(', ')}`);
	}
}

function normalizeRequestQuery(request: SentryRequest): string | undefined {
	// Prefer the already-serialized query-string aliases
	const qs = request.query_string ?? request.queryString;
	if (qs) return qs;

	// REST issue-event shape: `query` can be tuple pairs, a plain string, or a record
	const q = request.query;
	if (!q) return undefined;
	if (typeof q === 'string') return q;
	if (Array.isArray(q)) {
		const pairs = q.map(([k, v]) => `${k}=${v}`).join('&');
		return pairs || undefined;
	}
	// Record<string, string>
	const pairs = Object.entries(q)
		.map(([k, v]) => `${k}=${v}`)
		.join('&');
	return pairs || undefined;
}

function appendEventRequest(lines: string[], event: SentryEvent): void {
	const request = getEventRequest(event);
	if (!request?.url) return;
	lines.push('');
	lines.push('## Request');
	lines.push(`${request.method ?? 'GET'} ${request.url}`);
	const query = normalizeRequestQuery(request);
	if (query) lines.push(`Query: ${query}`);
	if (request.data !== undefined) lines.push(`Data: ${formatCompactValue(request.data)}`);
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
	const exceptions = getEventExceptions(event);
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

function appendEventContext(lines: string[], event: SentryEvent): void {
	const contextLines: string[] = [];
	for (const [key, value] of Object.entries(event.context ?? {})) {
		contextLines.push(`${key}: ${formatCompactValue(value)}`);
	}
	for (const [key, value] of Object.entries(event.contexts ?? {})) {
		if (value === undefined || value === null) continue;
		contextLines.push(`${key}: ${formatCompactValue(value)}`);
	}
	if (contextLines.length === 0) return;

	lines.push('');
	lines.push('## Context');
	for (const line of contextLines.slice(0, 20)) {
		lines.push(line);
	}
}

function normalizeTagPairs(
	tags: SentryEvent['tags'],
): Array<[string, string | number | boolean | null]> {
	if (!tags) return [];
	if (!Array.isArray(tags)) {
		return Object.entries(tags).filter(([key, value]) => key && value !== undefined);
	}

	const pairs: Array<[string, string | number | boolean | null]> = [];
	for (const tag of tags) {
		if (Array.isArray(tag)) {
			const [key, value] = tag;
			if (key && value !== undefined) pairs.push([key, value]);
			continue;
		}
		if (tag && typeof tag === 'object' && tag.key && tag.value !== undefined) {
			pairs.push([tag.key, tag.value]);
		}
	}
	return pairs;
}

function getEventId(event: SentryEvent): string | undefined {
	return event.event_id ?? event.eventID ?? event.id;
}

function getEventTimestamp(event: SentryEvent): string | undefined {
	return event.timestamp ?? event.dateCreated ?? event.dateReceived ?? event.received;
}

function getReleaseValue(release: SentryEvent['release']): string | undefined {
	if (!release) return undefined;
	if (typeof release === 'string') return release;
	if (typeof release === 'object') {
		const record = release as Record<string, unknown>;
		const value = record.version ?? record.shortVersion ?? record.package;
		return typeof value === 'string' ? value : undefined;
	}
	return undefined;
}

function findEntryData<T>(event: SentryEvent, type: string): T | undefined {
	const entry = event.entries?.find((candidate) => candidate.type === type);
	return entry?.data as T | undefined;
}

function getEventExceptions(event: SentryEvent): SentryException[] | undefined {
	return (
		event.exception?.values ??
		findEntryData<{ values?: SentryException[] }>(event, 'exception')?.values
	);
}

function getEventBreadcrumbs(event: SentryEvent): SentryBreadcrumb[] | undefined {
	return (
		event.breadcrumbs?.values ??
		findEntryData<{ values?: SentryBreadcrumb[] }>(event, 'breadcrumbs')?.values
	);
}

function getEventRequest(event: SentryEvent): SentryRequest | undefined {
	return event.request ?? findEntryData<SentryRequest>(event, 'request');
}

function formatCompactValue(value: unknown): string {
	if (typeof value === 'string') return value.slice(0, 200);
	if (typeof value === 'number' || typeof value === 'boolean' || value === null)
		return String(value);
	try {
		return JSON.stringify(value, null, 0).slice(0, 200);
	} catch {
		return String(value).slice(0, 200);
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

	const breadcrumbs = getEventBreadcrumbs(event);
	if (breadcrumbs?.length) {
		lines.push('');
		lines.push('## Breadcrumbs');
		lines.push(formatBreadcrumbs(breadcrumbs));
	}
	appendEventContext(lines, event);

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
		const ts = getEventTimestamp(e) ?? '(unknown time)';
		const eventId = getEventId(e);
		const id = eventId ? eventId.slice(0, 8) : '(no id)';
		const tx = e.transaction ? ` — ${e.transaction}` : '';
		lines.push(`  [${id}] ${ts}${tx}`);
	}
	return lines.join('\n');
}
