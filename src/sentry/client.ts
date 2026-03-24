/**
 * Sentry REST API client.
 *
 * Provides typed access to Sentry's API for reading issues and events.
 * Authentication uses a Bearer token sourced from SENTRY_API_TOKEN env var.
 *
 * Required token scopes: event:read
 * API base: https://sentry.io/api/0
 */

import type { SentryEvent, SentryIssue } from './types.js';

const SENTRY_API_BASE = 'https://sentry.io/api/0';

// ============================================================================
// Client interface
// ============================================================================

export interface SentryClient {
	/**
	 * Retrieve a single issue's metadata (title, culprit, status, counts, etc.)
	 * GET /api/0/organizations/{org}/issues/{issueId}/
	 */
	getIssue(organizationSlug: string, issueId: string): Promise<SentryIssue>;

	/**
	 * Retrieve a specific event for an issue (with full stacktrace, breadcrumbs, etc.)
	 * GET /api/0/organizations/{org}/issues/{issueId}/events/{eventId}/
	 * Use 'latest', 'oldest', or 'recommended' as eventId for convenience.
	 */
	getIssueEvent(organizationSlug: string, issueId: string, eventId?: string): Promise<SentryEvent>;

	/**
	 * List recent events for an issue.
	 * GET /api/0/organizations/{org}/issues/{issueId}/events/
	 */
	listIssueEvents(
		organizationSlug: string,
		issueId: string,
		options?: { limit?: number; full?: boolean },
	): Promise<SentryEvent[]>;
}

// ============================================================================
// Implementation
// ============================================================================

async function sentryFetch<T>(url: string, authToken: string): Promise<T> {
	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${authToken}`,
			'Content-Type': 'application/json',
		},
	});

	if (!response.ok) {
		const body = await response.text().catch(() => '');
		throw new Error(`Sentry API error ${response.status}: ${body}`);
	}

	return response.json() as Promise<T>;
}

function createSentryClient(authToken: string): SentryClient {
	return {
		async getIssue(organizationSlug: string, issueId: string): Promise<SentryIssue> {
			const url = `${SENTRY_API_BASE}/organizations/${encodeURIComponent(organizationSlug)}/issues/${encodeURIComponent(issueId)}/`;
			return sentryFetch<SentryIssue>(url, authToken);
		},

		async getIssueEvent(
			organizationSlug: string,
			issueId: string,
			eventId = 'latest',
		): Promise<SentryEvent> {
			const url = `${SENTRY_API_BASE}/organizations/${encodeURIComponent(organizationSlug)}/issues/${encodeURIComponent(issueId)}/events/${encodeURIComponent(eventId)}/`;
			return sentryFetch<SentryEvent>(url, authToken);
		},

		async listIssueEvents(
			organizationSlug: string,
			issueId: string,
			options: { limit?: number; full?: boolean } = {},
		): Promise<SentryEvent[]> {
			const params = new URLSearchParams();
			if (options.limit) params.set('limit', String(options.limit));
			if (options.full) params.set('full', 'true');
			const query = params.toString();
			const url = `${SENTRY_API_BASE}/organizations/${encodeURIComponent(organizationSlug)}/issues/${encodeURIComponent(issueId)}/events/${query ? `?${query}` : ''}`;
			return sentryFetch<SentryEvent[]>(url, authToken);
		},
	};
}

// ============================================================================
// Factory — uses SENTRY_API_TOKEN env var
// ============================================================================

/**
 * Create a Sentry API client from the environment.
 * Reads SENTRY_API_TOKEN from the environment.
 * Throws if the env var is not set.
 *
 * Workers are short-lived (one job per container), so a new client per call
 * is cheap and avoids stale-token issues in tests.
 */
export function getSentryClient(): SentryClient {
	const token = process.env.SENTRY_API_TOKEN;
	if (!token) throw new Error('SENTRY_API_TOKEN environment variable is not set');
	return createSentryClient(token);
}
