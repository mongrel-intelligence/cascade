/**
 * Shared logging helpers for the webhook handler factory.
 *
 * Extracted from webhookHandlers.ts to keep the factory module focused
 * on orchestration logic only.
 */

import type { Context } from 'hono';
import { captureException } from '../sentry.js';
import { logger } from '../utils/index.js';
import { logWebhookCall } from '../utils/webhookLogger.js';
import type { WebhookHandlerConfig, WebhookLogOverrides } from './webhookTypes.js';

/**
 * Log a successful webhook call, optionally enriched by log overrides
 * returned from `processWebhook`.
 */
export function logSuccessfulWebhook(
	source: WebhookHandlerConfig['source'],
	c: Context,
	rawHeaders: Record<string, string>,
	payload: unknown,
	eventType: string | undefined,
	// biome-ignore lint/suspicious/noConfusingVoidType: matches processWebhook return type
	logOverrides?: WebhookLogOverrides | void,
): void {
	logWebhookCall({
		source,
		method: c.req.method,
		path: c.req.path,
		headers: rawHeaders,
		body: payload,
		statusCode: 200,
		eventType,
		processed: logOverrides?.processed ?? true,
		projectId: logOverrides?.projectId,
		decisionReason: logOverrides?.decisionReason,
	});
}

/** Wrap processWebhook with standard error logging and Sentry capture. */
export function handleProcessingError(source: WebhookHandlerConfig['source'], err: unknown): void {
	logger.error(`Error processing ${source} webhook`, {
		error: String(err),
		stack: err instanceof Error ? err.stack : undefined,
	});
	captureException(err instanceof Error ? err : new Error(String(err)), {
		tags: { source: `${source}_webhook` },
	});
}
