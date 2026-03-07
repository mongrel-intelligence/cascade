/**
 * Generic webhook handler factory for Trello, GitHub, and JIRA endpoints.
 *
 * Router mode only: always awaits processing before returning 200
 * (so 200 means "job queued"). Errors propagate to Hono's error handler (500).
 *
 * Supports log enrichment via the return value of `processWebhook`. When
 * the callback returns `WebhookLogOverrides`, those fields override the
 * defaults in the webhook log entry. This is request-scoped and safe under
 * concurrent requests (no shared mutable state).
 */

import type { Context, Handler } from 'hono';
import { extractRawHeaders } from '../router/webhookParsing.js';
import { logger } from '../utils/index.js';
import { logWebhookCall } from '../utils/webhookLogger.js';
import { handleProcessingError, logSuccessfulWebhook } from './webhookLogging.js';

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export type { ParseResult, WebhookHandlerConfig, WebhookLogOverrides } from './webhookTypes.js';
export { parseGitHubPayload, parseJiraPayload, parseTrelloPayload } from './webhookParsers.js';

// ---------------------------------------------------------------------------
// Types (local import for factory use)
// ---------------------------------------------------------------------------

import type { WebhookHandlerConfig } from './webhookTypes.js';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a Hono POST handler for a webhook endpoint.
 *
 * The handler:
 * 1. Parses the request payload via `config.parsePayload`.
 * 2. Logs the webhook call to the database (both success and failure paths).
 * 3. Fires a fire-and-forget acknowledgment reaction on success.
 * 4. Awaits processing so 200 means "job queued."
 * 5. Returns 200 (or 400 on parse failure).
 */
export function createWebhookHandler(config: WebhookHandlerConfig): Handler {
	const { source, parsePayload, sendReaction, processWebhook } = config;

	return async (c: Context) => {
		const rawHeaders = extractRawHeaders(c);

		// --- Parse ---
		const parseResult = await parsePayload(c);

		if (!parseResult.ok) {
			logger.error(`Failed to parse ${source} webhook`, { error: parseResult.error });
			logWebhookCall({
				source,
				method: c.req.method,
				path: c.req.path,
				headers: rawHeaders,
				bodyRaw: parseResult.error,
				statusCode: 400,
				eventType: parseResult.eventType,
				processed: false,
				decisionReason: `Parse failed: ${parseResult.error}`,
			});
			return c.text('Bad Request', 400);
		}

		const { payload, eventType } = parseResult;

		// --- Reaction (fire-and-forget) ---
		if (sendReaction) {
			sendReaction(payload, eventType);
		}

		// --- Await processing (router mode always awaits) ---
		// Process synchronously so 200 means "job queued."
		// Errors propagate to Hono's error handler (500).
		try {
			const logOverrides = await processWebhook(payload, eventType);
			logSuccessfulWebhook(source, c, rawHeaders, payload, eventType, logOverrides);
		} catch (err) {
			handleProcessingError(source, err);
			throw err;
		}

		return c.text('OK', 200);
	};
}
