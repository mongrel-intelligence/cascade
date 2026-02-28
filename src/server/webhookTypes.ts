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
}

/**
 * Configuration object that drives a platform-specific webhook handler.
 * Each platform provides implementations for parsing and reaction dispatching;
 * the factory handles the common scaffolding around them.
 */
export interface WebhookHandlerConfig {
	/** Platform label used for logging and webhook log source field. */
	source: 'trello' | 'github' | 'jira';

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
	 * Processing callback. By default invoked via `setImmediate` (fire-and-forget)
	 * after a 200 is returned to the caller. When `fireAndForget` is `false`, the
	 * handler awaits this callback before responding — useful when processing must
	 * complete (e.g. job queuing) before acknowledging the webhook.
	 *
	 * May optionally return `WebhookLogOverrides` to enrich the webhook log entry
	 * (e.g. `processed`, `projectId`). This is the recommended way to communicate
	 * processing outcome to the log — it avoids shared mutable state and is
	 * inherently safe under concurrent requests.
	 *
	 * When `fireAndForget` is `true`, returned overrides are ignored (logging
	 * happens before processing starts). When `fireAndForget` is `false`, they
	 * are used to enrich the log after processing completes.
	 */
	processWebhook: (
		payload: unknown,
		eventType: string | undefined,
		// biome-ignore lint/suspicious/noConfusingVoidType: void needed for Promise<void> compat
	) => Promise<WebhookLogOverrides | void>;

	/**
	 * Whether to apply the global capacity gate (isCurrentlyProcessing &&
	 * !canAcceptWebhook → 503).  Set to `false` for the router deployment
	 * mode which handles back-pressure differently.
	 * Defaults to `true`.
	 */
	checkCapacity?: boolean;

	/**
	 * Whether to schedule `processWebhook` asynchronously via `setImmediate`
	 * (fire-and-forget) or await it before responding.
	 *
	 * - `true` (default) — server mode: respond 200 immediately, process later.
	 * - `false` — router mode: await processing so 200 means "job queued."
	 *   Errors from `processWebhook` propagate to Hono's error handler (500),
	 *   matching the old router behavior where a failure was not acknowledged
	 *   with 200.
	 */
	fireAndForget?: boolean;
}
