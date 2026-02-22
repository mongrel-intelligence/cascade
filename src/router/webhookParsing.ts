/**
 * Shared webhook parsing utilities used by both the router (multi-container)
 * and server (single-process) deployment modes.
 */

import type { Context } from 'hono';

export type PayloadParseResult = { ok: true; payload: unknown } | { ok: false; error: string };

/**
 * Parse a GitHub webhook payload, handling both JSON and
 * application/x-www-form-urlencoded content types.
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
		return { ok: true, payload: await c.req.json() };
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
