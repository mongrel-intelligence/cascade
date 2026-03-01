/**
 * Bot identity resolution for self-authored comment detection.
 *
 * Resolves the bot account IDs / member IDs for JIRA and Trello projects,
 * using a per-project TTL cache to avoid repeated API calls on every webhook.
 *
 * Extracted from `acknowledgments.ts` to keep that module focused on ack CRUD.
 */

import { BotIdentityCache } from './bot-identity.js';
import { resolveJiraCredentials, resolveTrelloCredentials } from './platformClients/index.js';

// ---------------------------------------------------------------------------
// JIRA bot identity
// ---------------------------------------------------------------------------

const jiraBotIdentityCache = new BotIdentityCache<string>('accountId');

/**
 * Resolve the JIRA account ID for the bot credentials linked to a project.
 * Cached per-project with 60s TTL. Returns null on any failure.
 */
export async function resolveJiraBotAccountId(projectId: string): Promise<string | null> {
	return jiraBotIdentityCache.resolve(projectId, async () => {
		const creds = await resolveJiraCredentials(projectId);
		if (!creds) return null;

		const response = await fetch(`${creds.baseUrl}/rest/api/2/myself`, {
			headers: { Authorization: `Basic ${creds.auth}`, Accept: 'application/json' },
		});
		if (!response.ok) return null;

		const data = (await response.json()) as { accountId?: string };
		return data.accountId ?? null;
	});
}

/** @internal Visible for testing only */
export function _resetJiraBotCache(): void {
	jiraBotIdentityCache._reset();
}

// ---------------------------------------------------------------------------
// Trello bot identity
// ---------------------------------------------------------------------------

const trelloBotIdentityCache = new BotIdentityCache<string>('memberId');

/**
 * Resolve the Trello member ID for the bot credentials linked to a project.
 * Cached per-project with 60s TTL. Returns null on any failure.
 */
export async function resolveTrelloBotMemberId(projectId: string): Promise<string | null> {
	return trelloBotIdentityCache.resolve(projectId, async () => {
		const creds = await resolveTrelloCredentials(projectId);
		if (!creds) return null;

		const response = await fetch(
			`https://api.trello.com/1/members/me?key=${creds.apiKey}&token=${creds.token}`,
			{ headers: { Accept: 'application/json' } },
		);
		if (!response.ok) return null;

		const data = (await response.json()) as { id?: string };
		return data.id ?? null;
	});
}

/** @internal Visible for testing only */
export function _resetTrelloBotCache(): void {
	trelloBotIdentityCache._reset();
}
