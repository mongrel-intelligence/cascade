/**
 * Bot identity resolution for self-authored comment detection.
 *
 * Resolves the bot account IDs / member IDs for JIRA and Trello projects,
 * using a per-project TTL cache to avoid repeated API calls on every webhook.
 *
 * Extracted from `acknowledgments.ts` to keep that module focused on ack CRUD.
 */

import { linearAuthHeader } from '../integrations/pm/_shared/auth-headers.js';
import { BotIdentityCache } from './bot-identity.js';
import {
	resolveJiraCredentials,
	resolveLinearCredentials,
	resolveTrelloCredentials,
} from './platformClients/index.js';

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

// ---------------------------------------------------------------------------
// Linear bot identity
// ---------------------------------------------------------------------------

export interface LinearBotIdentity {
	id: string;
	name: string;
	email: string;
	displayName: string;
}

const linearBotIdentityDetailsCache = new BotIdentityCache<LinearBotIdentity>('user');
const linearBotIdentityCache = new BotIdentityCache<string>('userId');

/**
 * Resolve the Linear user identity for the bot credentials linked to a project.
 * Uses the `viewer` query to fetch the authenticated user.
 * Cached per-project with 60s TTL. Returns null on any failure.
 */
export async function resolveLinearBotIdentity(
	projectId: string,
): Promise<LinearBotIdentity | null> {
	return linearBotIdentityDetailsCache.resolve(projectId, async () => {
		const creds = await resolveLinearCredentials(projectId);
		if (!creds) return null;

		const response = await fetch('https://api.linear.app/graphql', {
			method: 'POST',
			headers: linearAuthHeader(creds.apiKey),
			body: JSON.stringify({
				query: '{ viewer { id name email displayName } }',
			}),
		});
		if (!response.ok) return null;

		const data = (await response.json()) as {
			data?: {
				viewer?: {
					id?: string;
					name?: string;
					email?: string;
					displayName?: string;
				};
			};
		};
		const viewer = data.data?.viewer;
		if (!viewer?.id) return null;
		return {
			id: viewer.id,
			name: viewer.name ?? '',
			email: viewer.email ?? '',
			displayName: viewer.displayName ?? viewer.name ?? '',
		};
	});
}

/**
 * Resolve the Linear user ID for the bot credentials linked to a project.
 * Cached per-project with 60s TTL. Returns null on any failure.
 */
export async function resolveLinearBotUserId(projectId: string): Promise<string | null> {
	return linearBotIdentityCache.resolve(projectId, async () => {
		const identity = await resolveLinearBotIdentity(projectId);
		return identity?.id ?? null;
	});
}

/** @internal Visible for testing only */
export function _resetLinearBotCache(): void {
	linearBotIdentityDetailsCache._reset();
	linearBotIdentityCache._reset();
}
