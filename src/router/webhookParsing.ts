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
 * For JSON content type, reads raw text first so rawBody is preserved for
 * HMAC signature verification.
 */
export async function parseGitHubWebhookPayload(
	c: Context,
	contentType: string,
): Promise<PayloadParseResult> {
	try {
		if (contentType.includes('application/x-www-form-urlencoded')) {
			const formData = await c.req.parseBody();
			const payloadStr = formData.payload;
			if (typeof payloadStr === 'string') {
				return { ok: true, payload: JSON.parse(payloadStr) };
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
