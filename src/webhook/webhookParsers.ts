/**
 * Platform-specific webhook payload parsers.
 *
 * Each parser reads the raw Hono request and returns a `ParseResult`
 * indicating success (with the structured payload and event type) or
 * failure (with an error string for logging / 400 response).
 */

import type { Context } from 'hono';
import { parseGitHubWebhookPayload } from '../router/webhookParsing.js';
import { logger } from '../utils/index.js';
import type { ParseResult } from './webhookTypes.js';

/**
 * Parse a Trello webhook request (plain JSON).
 * Extracts `action.type` as the event type.
 */
export async function parseTrelloPayload(c: Context): Promise<ParseResult> {
	try {
		const rawBody = await c.req.text();
		const payload = JSON.parse(rawBody);
		const eventType = (payload as Record<string, unknown>)?.action
			? ((payload as Record<string, Record<string, unknown>>).action.type as string | undefined)
			: undefined;
		logger.debug('Received Trello webhook', { action: eventType });
		return { ok: true, payload, eventType, rawBody };
	} catch (err) {
		return { ok: false, error: String(err) };
	}
}

/**
 * Parse a GitHub webhook request (JSON or form-encoded).
 * Event type comes from the `X-GitHub-Event` header.
 */
export async function parseGitHubPayload(c: Context): Promise<ParseResult> {
	const eventType = c.req.header('X-GitHub-Event') || 'unknown';
	const contentType = c.req.header('Content-Type') || '';
	const result = await parseGitHubWebhookPayload(c, contentType);
	if (!result.ok) {
		logger.error('Failed to parse GitHub webhook', {
			error: result.error,
			contentType,
			eventType,
		});
		return { ok: false, error: result.error, eventType };
	}
	const payload = result.payload;
	const rawBody = result.rawBody;
	logger.info('Received GitHub webhook', {
		event: eventType,
		contentType,
		action: (payload as Record<string, unknown>)?.action,
		repository: ((payload as Record<string, unknown>)?.repository as Record<string, unknown>)
			?.full_name,
	});
	return { ok: true, payload, eventType, rawBody };
}

/**
 * Parse a Sentry webhook request.
 * Event type comes from the `Sentry-Hook-Resource` header.
 * The cascadeProjectId (from the URL path param) must be passed explicitly
 * since Hono path params are not available in this generic parser.
 *
 * Returns an augmented payload that the SentryRouterAdapter understands.
 */
export async function parseSentryPayload(
	c: Context,
	cascadeProjectId: string,
): Promise<ParseResult> {
	try {
		const rawBody = await c.req.text();
		const innerPayload = JSON.parse(rawBody);
		const resource = c.req.header('Sentry-Hook-Resource') ?? 'unknown';
		const action = (innerPayload as Record<string, unknown>)?.action as string | undefined;

		logger.info('Received Sentry webhook', {
			resource,
			action,
			projectId: cascadeProjectId,
		});

		// Build the augmented payload that SentryRouterAdapter expects
		const payload = {
			resource,
			payload: innerPayload,
			cascadeProjectId,
		};

		return { ok: true, payload, eventType: resource, rawBody };
	} catch (err) {
		return { ok: false, error: String(err) };
	}
}

/**
 * Parse a JIRA webhook request (plain JSON).
 * Extracts `webhookEvent` as the event type.
 */
export async function parseJiraPayload(c: Context): Promise<ParseResult> {
	try {
		const rawBody = await c.req.text();
		const payload = JSON.parse(rawBody);
		const eventType = (payload as Record<string, unknown>)?.webhookEvent as string | undefined;
		logger.info('Received JIRA webhook', {
			event: eventType,
			issueKey: ((payload as Record<string, unknown>)?.issue as Record<string, unknown>)?.key,
		});
		return { ok: true, payload, eventType, rawBody };
	} catch (err) {
		return { ok: false, error: String(err) };
	}
}
