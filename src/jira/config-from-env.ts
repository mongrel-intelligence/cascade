/**
 * The single place a worker rebuilds its JIRA config from environment variables.
 *
 * `cascade-tools` and the friction gadget both run without database access and
 * must reconstruct `JiraConfig` from what `augmentProjectSecrets` emitted. Until
 * spec 024 they each hand-picked the fields independently, which is how the
 * routing discriminator came to be threaded into one and not the other — an
 * agent's friction reports were then filed unstamped and routed to the wrong
 * project on a shared board.
 *
 * That was the tenth instance of "a JIRA config field silently dropped by a
 * hand-written projection" in this area. Two parallel synthesizers guarantee an
 * eleventh, so there is now one: a field added here reaches every worker-side
 * consumer, and a field forgotten here is missing from all of them at once,
 * which is far easier to notice than missing from exactly one.
 */

import { normalizeJiraAuthType } from './authType.js';

export interface JiraRoutingDiscriminator {
	kind: 'label' | 'component';
	value: string;
}

export interface JiraConfigFromEnv {
	projectKey: string;
	baseUrl: string;
	authType: ReturnType<typeof normalizeJiraAuthType>;
	statuses: Record<string, string>;
	routing?: { discriminator: JiraRoutingDiscriminator };
}

/** `JIRA_BASE_URL` wins, matching the CLI's historical precedence. */
export function resolveJiraBaseUrlFromEnv(): string | undefined {
	return process.env.JIRA_BASE_URL || process.env.CASCADE_JIRA_BASE_URL;
}

function parseJsonRecord(value: string | undefined): Record<string, string> {
	if (!value) return {};
	try {
		const parsed = JSON.parse(value) as unknown;
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, string>)
			: {};
	} catch {
		return {};
	}
}

/**
 * Parse the routing discriminator (spec 024).
 *
 * Degrades to "no discriminator" on anything malformed rather than throwing:
 * this runs at the head of every `cascade-tools` invocation, so a truncated or
 * hand-edited value must not take every command down with it.
 */
export function parseJiraRoutingFromEnv(
	raw: string | undefined = process.env.CASCADE_JIRA_ROUTING,
): { discriminator: JiraRoutingDiscriminator } | undefined {
	if (!raw) return undefined;
	try {
		const parsed = JSON.parse(raw) as { discriminator?: { kind?: string; value?: string } };
		const d = parsed?.discriminator;
		if (!d || (d.kind !== 'label' && d.kind !== 'component')) return undefined;
		if (typeof d.value !== 'string' || d.value.length === 0) return undefined;
		return { discriminator: { kind: d.kind, value: d.value } };
	} catch {
		return undefined;
	}
}

/**
 * The injected auth mode, for the credential scope.
 *
 * A different concern from config synthesis — it picks the REST host, not what
 * the provider reads — but it comes from the same env var, so it lives with the
 * other readers rather than being a second place that knows the name.
 */
export function resolveJiraAuthTypeFromEnv(): ReturnType<typeof normalizeJiraAuthType> {
	return normalizeJiraAuthType(process.env.CASCADE_JIRA_AUTH_TYPE);
}

/** Rebuild the worker's JIRA config from `augmentProjectSecrets`' output. */
export function buildJiraConfigFromEnv(): JiraConfigFromEnv {
	const routing = parseJiraRoutingFromEnv();
	return {
		projectKey: process.env.CASCADE_JIRA_PROJECT_KEY ?? '',
		baseUrl: resolveJiraBaseUrlFromEnv() ?? '',
		authType: normalizeJiraAuthType(process.env.CASCADE_JIRA_AUTH_TYPE),
		statuses: parseJsonRecord(process.env.CASCADE_JIRA_STATUSES),
		// Omitted rather than set to undefined so an unshared project's config is
		// byte-identical to before spec 024.
		...(routing ? { routing } : {}),
	};
}
