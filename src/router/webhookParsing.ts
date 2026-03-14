/**
 * Shared webhook parsing utilities used by both the router (multi-container)
 * and server (single-process) deployment modes.
 */

import type { Context } from 'hono';

export type PayloadParseResult =
	| { ok: true; payload: unknown; rawBody?: string }
	| { ok: false; error: string };

/**
 * Parse a GitHub webhook payload, handling both JSON and
 * application/x-www-form-urlencoded content types.
 * For both content types, reads raw text first so rawBody is preserved for
 * HMAC signature verification.
 * GitHub computes the HMAC over the raw HTTP body, so rawBody must reflect
 * the exact bytes sent by GitHub (the form-encoded string for urlencoded,
 * the JSON string for JSON delivery).
 */
export async function parseGitHubWebhookPayload(
	c: Context,
	contentType: string,
): Promise<PayloadParseResult> {
	try {
		if (contentType.includes('application/x-www-form-urlencoded')) {
			// Read raw body first so HMAC verification can use the exact bytes.
			const rawBody = await c.req.text();
			const params = new URLSearchParams(rawBody);
			const payloadStr = params.get('payload');
			if (typeof payloadStr === 'string') {
				return { ok: true, payload: JSON.parse(payloadStr), rawBody };
			}
			throw new Error('Missing payload field in form data');
		}
		const rawBody = await c.req.text();
		return { ok: true, payload: JSON.parse(rawBody), rawBody };
	} catch (err) {
		return { ok: false, error: String(err) };
	}
}

/**
 * Extract all request headers as a plain string-keyed object.
 * Used for webhook call logging.
 */
export function extractRawHeaders(c: Context): Record<string, string> {
	return Object.fromEntries(Object.entries(c.req.header()).map(([k, v]) => [k, String(v)]));
}
