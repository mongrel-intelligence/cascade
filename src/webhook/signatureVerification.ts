/**
 * HMAC signature verification for webhook payloads.
 *
 * Provides timing-safe verification for GitHub (SHA-256) and Trello (SHA-1) webhooks.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verify a GitHub webhook signature.
 *
 * GitHub signs payloads with HMAC-SHA256 and sends the result as
 * `sha256=<hex>` in the `X-Hub-Signature-256` header.
 *
 * @param rawBody - The raw request body string.
 * @param signature - The value of the `X-Hub-Signature-256` header.
 * @param secret - The webhook secret configured in GitHub.
 * @returns `true` if the signature is valid, `false` otherwise.
 */
export function verifyGitHubSignature(rawBody: string, signature: string, secret: string): boolean {
	if (!signature || !signature.startsWith('sha256=')) {
		return false;
	}

	const expectedHex = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
	const expected = Buffer.from(`sha256=${expectedHex}`, 'utf8');
	const actual = Buffer.from(signature, 'utf8');

	if (expected.length !== actual.length) {
		return false;
	}

	return timingSafeEqual(expected, actual);
}

/**
 * Verify a Trello webhook signature.
 *
 * Trello signs payloads with HMAC-SHA1 over `body + callbackUrl` and sends the
 * result as a base64 string in the `X-Trello-Webhook` header.
 *
 * @param rawBody - The raw request body string.
 * @param callbackUrl - The full callback URL that Trello was configured with.
 * @param signature - The value of the `X-Trello-Webhook` header.
 * @param secret - The Trello API secret / token.
 * @returns `true` if the signature is valid, `false` otherwise.
 */
export function verifyTrelloSignature(
	rawBody: string,
	callbackUrl: string,
	signature: string,
	secret: string,
): boolean {
	if (!signature) {
		return false;
	}

	const expectedBase64 = createHmac('sha1', secret)
		.update(rawBody + callbackUrl, 'utf8')
		.digest('base64');

	const expected = Buffer.from(expectedBase64, 'utf8');
	const actual = Buffer.from(signature, 'utf8');

	if (expected.length !== actual.length) {
		return false;
	}

	return timingSafeEqual(expected, actual);
}
