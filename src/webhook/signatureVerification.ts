/**
 * HMAC signature verification for webhook payloads.
 *
 * Provides timing-safe verification for GitHub (SHA-256), Trello (SHA-1), and
 * JIRA (SHA-256) webhooks.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

// ---------------------------------------------------------------------------
// Generic helper
// ---------------------------------------------------------------------------

/**
 * Options for {@link verifyHmac}.
 */
export interface VerifyHmacOptions {
	/** HMAC algorithm, e.g. `'sha256'` or `'sha1'`. */
	algorithm: string;
	/** The raw data to sign (e.g. request body, or body + callbackUrl for Trello). */
	data: string;
	/** The secret key. */
	secret: string;
	/** The signature received from the caller. */
	signature: string;
	/** Digest encoding: `'hex'` or `'base64'`. */
	encoding: 'hex' | 'base64';
	/**
	 * Optional prefix that the computed digest should be wrapped in before
	 * comparison (e.g. `'sha256='` for GitHub/JIRA). When provided the
	 * comparison string becomes `<prefix><digest>`.
	 */
	prefix?: string;
}

/**
 * Generic timing-safe HMAC verification.
 *
 * Computes `HMAC(algorithm, secret).update(data).digest(encoding)`, optionally
 * prepends `prefix`, then does a constant-time comparison against `signature`.
 *
 * Returns `false` immediately when `signature` is empty, has the wrong prefix,
 * or has a different byte-length than the expected value (short-circuit that
 * does not leak timing information about the secret itself).
 */
export function verifyHmac({
	algorithm,
	data,
	secret,
	signature,
	encoding,
	prefix = '',
}: VerifyHmacOptions): boolean {
	if (!signature) {
		return false;
	}

	if (prefix && !signature.startsWith(prefix)) {
		return false;
	}

	const digest = createHmac(algorithm, secret).update(data, 'utf8').digest(encoding);
	const expected = Buffer.from(`${prefix}${digest}`, 'utf8');
	const actual = Buffer.from(signature, 'utf8');

	if (expected.length !== actual.length) {
		return false;
	}

	return timingSafeEqual(expected, actual);
}

// ---------------------------------------------------------------------------
// Per-platform public API (unchanged signatures)
// ---------------------------------------------------------------------------

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
	return verifyHmac({
		algorithm: 'sha256',
		data: rawBody,
		secret,
		signature,
		encoding: 'hex',
		prefix: 'sha256=',
	});
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
	return verifyHmac({
		algorithm: 'sha1',
		data: rawBody + callbackUrl,
		secret,
		signature,
		encoding: 'base64',
	});
}

/**
 * Verify a Sentry webhook signature.
 *
 * Sentry signs payloads with HMAC-SHA256 and sends the result as a raw hex
 * digest in the `Sentry-Hook-Signature` header (no `sha256=` prefix).
 *
 * @param rawBody - The raw request body string.
 * @param signature - The value of the `Sentry-Hook-Signature` header.
 * @param secret - The webhook secret configured in Sentry.
 * @returns `true` if the signature is valid, `false` otherwise.
 */
export function verifySentrySignature(rawBody: string, signature: string, secret: string): boolean {
	return verifyHmac({
		algorithm: 'sha256',
		data: rawBody,
		secret,
		signature,
		encoding: 'hex',
	});
}

/**
 * Verify a JIRA webhook signature.
 *
 * JIRA Cloud signs payloads with HMAC-SHA256 and sends the result as
 * `sha256=<hex>` in the `X-Hub-Signature` header.
 *
 * @param rawBody - The raw request body string.
 * @param signature - The value of the `X-Hub-Signature` header.
 * @param secret - The webhook secret configured in JIRA.
 * @returns `true` if the signature is valid, `false` otherwise.
 */
export function verifyJiraSignature(rawBody: string, signature: string, secret: string): boolean {
	return verifyHmac({
		algorithm: 'sha256',
		data: rawBody,
		secret,
		signature,
		encoding: 'hex',
		prefix: 'sha256=',
	});
}
