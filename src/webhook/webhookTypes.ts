/**
 * Shared types for the webhook handler factory.
 */

import type { Context } from 'hono';

/** Result returned by a payload parser. */
export type ParseResult =
	| { ok: true; payload: unknown; eventType?: string }
	| { ok: false; error: string; eventType?: string };

/**
 * Fields that can enrich the webhook log entry.
 * Returned from `processWebhook` to override default log values.
 */
export interface WebhookLogOverrides {
	processed?: boolean;
	projectId?: string;
	decisionReason?: string;
}

/**
 * Configuration object that drives a platform-specific webhook handler.
 * Each platform provides implementations for parsing and reaction dispatching;
 * the factory handles the common scaffolding around them.
 */
export interface WebhookHandlerConfig {
	/** Platform label used for logging and webhook log source field. */
	source: string;

	/**
	 * Parse the raw Hono request into a structured payload.
	 * Return `{ ok: false, error }` to short-circuit with a 400 response.
	 */
	parsePayload: (c: Context) => Promise<ParseResult>;

	/**
	 * Fire-and-forget acknowledgment reaction.
	 * Called only when `parsePayload` succeeds.
	 * Errors are caught internally — must never propagate.
	 */
	sendReaction?: (payload: unknown, eventType: string | undefined) => void;

	/**
	 * Processing callback. The handler awaits this callback before responding,
	 * so 200 means "job queued." Errors propagate to Hono's error handler (500).
	 *
	 * May optionally return `WebhookLogOverrides` to enrich the webhook log entry.
	 */
	processWebhook: (
		payload: unknown,
		eventType: string | undefined,
		headers: Record<string, string>,
		// biome-ignore lint/suspicious/noConfusingVoidType: void needed for Promise<void> compat
	) => Promise<WebhookLogOverrides | void>;
}
