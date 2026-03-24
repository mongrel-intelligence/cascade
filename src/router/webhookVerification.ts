/**
 * Webhook signature verification helpers for the router.
 *
 * Extracted from src/router/index.ts so the functions can be imported and
 * tested directly without importing the side-effect-heavy entry-point module.
 */

import type { Context } from 'hono';
import { logger } from '../utils/logging.js';
import {
	verifyGitHubSignature,
	verifyJiraSignature,
	verifySentrySignature,
	verifyTrelloSignature,
} from '../webhook/signatureVerification.js';
import { loadProjectConfig, routerConfig } from './config.js';
import { resolveWebhookSecret } from './platformClients/credentials.js';

/** The set of platforms that have a webhook secret in {@link resolveWebhookSecret}. */
type WebhookPlatform = 'github' | 'trello' | 'jira' | 'sentry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the Trello board ID from a raw webhook payload.
 * Trello sends the board ID at `action.data.board.id` or, for board-level
 * events, at `model.id`.
 */
export function extractTrelloBoardId(rawBody: string): string | undefined {
	try {
		const parsed = JSON.parse(rawBody) as Record<string, unknown>;
		const boardId = (
			((parsed?.action as Record<string, unknown>)?.data as Record<string, unknown>)
				?.board as Record<string, unknown>
		)?.id as string | undefined;
		if (boardId) return boardId;
		return (parsed?.model as Record<string, unknown>)?.id as string | undefined;
	} catch {
		return undefined;
	}
}

/**
 * Build the Trello webhook callback URL.
 * Uses `routerConfig.webhookCallbackBaseUrl` when set; otherwise derives the
 * base URL from the request's `x-forwarded-proto` / `host` headers.
 *
 * Logs a warning when `host` is undefined and no base URL is configured, since
 * the resulting URL (`https://undefined/trello/webhook`) will cause a silent
 * signature mismatch (401).
 */
export function buildTrelloCallbackUrl(
	host: string | undefined,
	proto: string | undefined,
): string {
	if (routerConfig.webhookCallbackBaseUrl) {
		return `${routerConfig.webhookCallbackBaseUrl}/trello/webhook`;
	}
	if (!host) {
		logger.warn(
			'buildTrelloCallbackUrl: Host header is missing and WEBHOOK_CALLBACK_BASE_URL is not set. ' +
				'Trello signature verification will fail. Set WEBHOOK_CALLBACK_BASE_URL to fix this.',
		);
	}
	return `${proto ?? 'https'}://${host}/trello/webhook`;
}

// ---------------------------------------------------------------------------
// createWebhookVerifier factory
// ---------------------------------------------------------------------------

/**
 * Configuration for {@link createWebhookVerifier}.
 *
 * @template TProjectId - The type used to identify a project (e.g. string).
 */
export interface WebhookVerifierConfig<TProjectId = string> {
	/**
	 * Extract the platform identifier (board ID, repo name, project key, …)
	 * from the raw request body and/or Hono context.
	 * Return `undefined` to skip verification (no identifier → no project match).
	 */
	extractIdentifier: (c: Context, rawBody: string) => string | undefined;
	/**
	 * Find the project that owns this webhook by matching the extracted
	 * identifier. Return `undefined` when no project matches (skip verification).
	 */
	findProject: (
		identifier: string,
		projects: Array<Record<string, unknown>>,
	) => { id: TProjectId } | undefined;
	/** Platform name passed to `resolveWebhookSecret` (e.g. `'github'`). */
	platform: WebhookPlatform;
	/** Header name that carries the signature. */
	headerName: string;
	/**
	 * Verify the raw signature string against the body and secret.
	 * Return `true` if valid.
	 */
	verify: (rawBody: string, signatureHeader: string, secret: string, c: Context) => boolean;
	/** Human-readable label used in the mismatch error reason (e.g. `'GitHub'`). */
	platformLabel: string;
}

/**
 * Factory that creates a `verifySignature` callback for Hono webhook handlers.
 *
 * All four platform verifiers follow the same pattern:
 *   1. Extract a header value (signature).
 *   2. Extract a platform identifier from the body (board ID, repo, project key…).
 *   3. Look up the project in config.
 *   4. Resolve the webhook secret for that project.
 *   5. Verify the signature, returning a structured result.
 *
 * `createWebhookVerifier` captures steps 1–5 in a single reusable closure,
 * parameterised by the small per-platform details supplied in `config`.
 */
export function createWebhookVerifier<TProjectId = string>(
	config: WebhookVerifierConfig<TProjectId>,
): (c: Context, rawBody: string) => Promise<{ valid: boolean; reason: string } | null> {
	const { extractIdentifier, findProject, platform, headerName, verify, platformLabel } = config;

	return async function verifyWebhookSignature(
		c: Context,
		rawBody: string,
	): Promise<{ valid: boolean; reason: string } | null> {
		const signatureHeader = c.req.header(headerName);
		const identifier = extractIdentifier(c, rawBody);

		if (!identifier) return null;

		const { projects } = await loadProjectConfig();
		// Cast is safe: loadProjectConfig returns typed project objects; we only
		// need `id` from the result, and findProject may do deeper matching.
		const project = findProject(identifier, projects as unknown as Array<Record<string, unknown>>);
		if (!project) return null;

		const secret = await resolveWebhookSecret(project.id as string, platform);
		if (!secret) return null; // No secret configured — skip verification

		if (!signatureHeader) {
			return { valid: false, reason: 'Missing signature header' };
		}

		const valid = verify(rawBody, signatureHeader, secret, c);
		return valid
			? { valid: true, reason: 'Signature valid' }
			: { valid: false, reason: `${platformLabel} signature mismatch` };
	};
}

// ---------------------------------------------------------------------------
// verifySignature callbacks (one per platform)
// ---------------------------------------------------------------------------

/**
 * verifySignature callback for the Trello webhook handler.
 * Returns null to skip verification when no secret is configured (backwards compat).
 */
export const verifyTrelloWebhookSignature = createWebhookVerifier({
	headerName: 'x-trello-webhook',
	platform: 'trello',
	platformLabel: 'Trello',
	extractIdentifier: (_c, rawBody) => extractTrelloBoardId(rawBody),
	findProject: (boardId, projects) =>
		projects.find((p) => (p.trello as Record<string, unknown> | undefined)?.boardId === boardId) as
			| { id: string }
			| undefined,
	verify: (rawBody, sig, secret, c) =>
		verifyTrelloSignature(
			rawBody,
			buildTrelloCallbackUrl(c.req.header('host'), c.req.header('x-forwarded-proto')),
			sig,
			secret,
		),
});

/**
 * verifySignature callback for the GitHub webhook handler.
 * Returns null to skip verification when no secret is configured (backwards compat).
 */
export const verifyGitHubWebhookSignature = createWebhookVerifier({
	headerName: 'X-Hub-Signature-256',
	platform: 'github',
	platformLabel: 'GitHub',
	extractIdentifier: (_c, rawBody) => {
		try {
			// Try JSON first (application/json delivery).
			const parsed = JSON.parse(rawBody) as Record<string, unknown>;
			const repoFullName = (parsed?.repository as Record<string, unknown>)?.full_name as
				| string
				| undefined;
			if (repoFullName) return repoFullName;
		} catch {
			// Not JSON — try application/x-www-form-urlencoded delivery.
		}
		try {
			// GitHub sends the payload as `payload=<url-encoded JSON>` in that case.
			const payloadStr = new URLSearchParams(rawBody).get('payload');
			if (payloadStr) {
				const parsed = JSON.parse(payloadStr) as Record<string, unknown>;
				return (parsed?.repository as Record<string, unknown>)?.full_name as string | undefined;
			}
		} catch {
			// Unparseable body — fall through to undefined
		}
		return undefined;
	},
	findProject: (repoFullName, projects) =>
		projects.find((p) => p.repo === repoFullName) as { id: string } | undefined,
	verify: (rawBody, sig, secret) => verifyGitHubSignature(rawBody, sig, secret),
});

/**
 * verifySignature callback for the Sentry webhook handler.
 * Returns null to skip verification when no secret is configured (backwards compat).
 *
 * Sentry sends the signature as a raw HMAC-SHA256 hex digest in the
 * `Sentry-Hook-Signature` header (no `sha256=` prefix).
 *
 * The project ID is taken from the URL path param (`:projectId`),
 * which is unambiguous since each Sentry integration gets its own webhook URL.
 */
export const verifySentryWebhookSignature = createWebhookVerifier({
	headerName: 'Sentry-Hook-Signature',
	platform: 'sentry',
	platformLabel: 'Sentry',
	// Sentry uses the URL path param as its identifier (projectId), not the body.
	extractIdentifier: (c, _rawBody) => c.req.param('projectId'),
	// For Sentry the identifier IS the project ID — find by direct ID match.
	findProject: (projectId, projects) =>
		projects.find((p) => p.id === projectId) as { id: string } | undefined,
	verify: (rawBody, sig, secret) => verifySentrySignature(rawBody, sig, secret),
});

/**
 * Extract the JIRA project key from a raw webhook payload.
 * JIRA sends the project key at `issue.fields.project.key`.
 */
export function extractJiraProjectKey(rawBody: string): string | undefined {
	try {
		const parsed = JSON.parse(rawBody) as Record<string, unknown>;
		const issue = parsed?.issue as Record<string, unknown> | undefined;
		const fields = issue?.fields as Record<string, unknown> | undefined;
		const project = fields?.project as Record<string, unknown> | undefined;
		return project?.key as string | undefined;
	} catch {
		return undefined;
	}
}

/**
 * verifySignature callback for the JIRA webhook handler.
 * Returns null to skip verification when no secret is configured (backwards compat).
 *
 * JIRA Cloud sends the signature as `sha256=<hex>` in the `X-Hub-Signature` header.
 */
export const verifyJiraWebhookSignature = createWebhookVerifier({
	headerName: 'X-Hub-Signature',
	platform: 'jira',
	platformLabel: 'JIRA',
	extractIdentifier: (_c, rawBody) => extractJiraProjectKey(rawBody),
	findProject: (jiraProjectKey, projects) =>
		projects.find(
			(p) => (p.jira as Record<string, unknown> | undefined)?.projectKey === jiraProjectKey,
		) as { id: string } | undefined,
	verify: (rawBody, sig, secret) => verifyJiraSignature(rawBody, sig, secret),
});
