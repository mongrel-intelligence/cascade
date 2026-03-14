/**
 * Webhook signature verification helpers for the router.
 *
 * Extracted from src/router/index.ts so the functions can be imported and
 * tested directly without importing the side-effect-heavy entry-point module.
 */

import type { Context } from 'hono';
import { logger } from '../utils/logging.js';
import { verifyGitHubSignature, verifyTrelloSignature } from '../webhook/signatureVerification.js';
import { loadProjectConfig, routerConfig } from './config.js';
import { resolveWebhookSecret } from './platformClients/credentials.js';

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
// verifySignature callbacks
// ---------------------------------------------------------------------------

/**
 * verifySignature callback for the Trello webhook handler.
 * Returns null to skip verification when no secret is configured (backwards compat).
 */
export async function verifyTrelloWebhookSignature(
	c: Context,
	rawBody: string,
): Promise<{ valid: boolean; reason: string } | null> {
	const signatureHeader = c.req.header('x-trello-webhook');
	const boardId = extractTrelloBoardId(rawBody);

	if (!boardId) return null;

	const { projects } = await loadProjectConfig();
	const project = projects.find((p) => p.trello?.boardId === boardId);
	if (!project) return null;

	const secret = await resolveWebhookSecret(project.id, 'trello');
	if (!secret) return null; // No secret configured — skip verification

	if (!signatureHeader) {
		return { valid: false, reason: 'Missing signature header' };
	}

	const callbackUrl = buildTrelloCallbackUrl(
		c.req.header('host'),
		c.req.header('x-forwarded-proto'),
	);
	const valid = verifyTrelloSignature(rawBody, callbackUrl, signatureHeader, secret);
	return valid
		? { valid: true, reason: 'Signature valid' }
		: { valid: false, reason: 'Trello signature mismatch' };
}

/**
 * verifySignature callback for the GitHub webhook handler.
 * Returns null to skip verification when no secret is configured (backwards compat).
 */
export async function verifyGitHubWebhookSignature(
	c: Context,
	rawBody: string,
): Promise<{ valid: boolean; reason: string } | null> {
	const signatureHeader = c.req.header('X-Hub-Signature-256');

	let repoFullName: string | undefined;
	try {
		const parsed = JSON.parse(rawBody) as Record<string, unknown>;
		repoFullName = (parsed?.repository as Record<string, unknown>)?.full_name as string | undefined;
	} catch {
		// If we can't parse the repo, skip verification
	}

	if (!repoFullName) return null;

	const { projects } = await loadProjectConfig();
	const project = projects.find((p) => p.repo === repoFullName);
	if (!project) return null;

	const secret = await resolveWebhookSecret(project.id, 'github');
	if (!secret) return null; // No secret configured — skip verification

	if (!signatureHeader) {
		return { valid: false, reason: 'Missing signature header' };
	}

	const valid = verifyGitHubSignature(rawBody, signatureHeader, secret);
	return valid
		? { valid: true, reason: 'Signature valid' }
		: { valid: false, reason: 'GitHub signature mismatch' };
}
