/**
 * Generic webhook handler factory for Trello, GitHub, and JIRA endpoints.
 *
 * Eliminates the three near-identical 50-60 line POST handler blocks that
 * previously existed in both `src/server.ts` and `src/router/index.ts` by
 * extracting the shared flow (capacity check, header extraction, parse,
 * log, react, process) into a single parameterized factory.
 *
 * Supports two processing modes via `fireAndForget`:
 * - `true` (default, server mode): respond 200 immediately, process later.
 * - `false` (router mode): await processing so 200 means "job queued."
 *   Errors propagate to Hono's error handler (500), preserving the old
 *   router behavior.
 *
 * Supports log enrichment via the return value of `processWebhook`. When
 * the callback returns `WebhookLogOverrides`, those fields override the
 * defaults in the webhook log entry. This is request-scoped and safe under
 * concurrent requests (no shared mutable state).
 */

import type { Context, Handler } from 'hono';
import { extractRawHeaders } from '../router/webhookParsing.js';
import { canAcceptWebhook, isCurrentlyProcessing, logger } from '../utils/index.js';
import { logWebhookCall } from '../utils/webhookLogger.js';
import { handleProcessingError, logSuccessfulWebhook } from './webhookLogging.js';

// ---------------------------------------------------------------------------
// Re-exports for backward compatibility
// ---------------------------------------------------------------------------

export type { ParseResult, WebhookHandlerConfig, WebhookLogOverrides } from './webhookTypes.js';
export { parseGitHubPayload, parseJiraPayload, parseTrelloPayload } from './webhookParsers.js';
export { buildReactionSender } from './webhookReactionSender.js';

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
 * 1. Optionally checks machine capacity (503 if over limit).
 * 2. Parses the request payload via `config.parsePayload`.
 * 3. Logs the webhook call to the database (both success and failure paths).
 * 4. Fires a fire-and-forget acknowledgment reaction on success.
 * 5. Processes the webhook (fire-and-forget or awaited, per `fireAndForget`).
 * 6. Returns 200 immediately (or 400/503 on failure).
 */
export function createWebhookHandler(config: WebhookHandlerConfig): Handler {
	const {
		source,
		parsePayload,
		sendReaction,
		processWebhook,
		checkCapacity = true,
		fireAndForget = true,
	} = config;

	return async (c: Context) => {
		// --- Capacity gate (server mode only) ---
		if (checkCapacity && isCurrentlyProcessing() && !canAcceptWebhook()) {
			logger.warn('Machine at capacity, returning 503');
			return c.text('Service Unavailable', 503);
		}

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
			});
			return c.text('Bad Request', 400);
		}

		const { payload, eventType } = parseResult;

		// --- Reaction (fire-and-forget) ---
		if (sendReaction) {
			sendReaction(payload, eventType);
		}

		if (fireAndForget) {
			// --- Log then process asynchronously (server mode) ---
			// Log overrides from processWebhook are not available in this mode
			// because processing hasn't started yet.
			logSuccessfulWebhook(source, c, rawHeaders, payload, eventType);
			setImmediate(() => {
				processWebhook(payload, eventType).catch((err) => handleProcessingError(source, err));
			});
		} else {
			// --- Await processing then log (router mode) ---
			// Process synchronously so 200 means "job queued."
			// Errors propagate to Hono's error handler (500), matching old router
			// behavior where a processing failure was not acknowledged with 200.
			const logOverrides = await processWebhook(payload, eventType);
			logSuccessfulWebhook(source, c, rawHeaders, payload, eventType, logOverrides);
		}

		return c.text('OK', 200);
	};
}
