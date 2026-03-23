import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	verifyGitHubSignature,
	verifyHmac,
	verifyJiraSignature,
	verifySentrySignature,
	verifyTrelloSignature,
} from '../../../src/webhook/signatureVerification.js';

// ---------------------------------------------------------------------------
// Helpers — generate valid signatures for test vectors
// ---------------------------------------------------------------------------

function githubSignature(body: string, secret: string): string {
	const hex = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
	return `sha256=${hex}`;
}

function trelloSignature(body: string, callbackUrl: string, secret: string): string {
	return createHmac('sha1', secret)
		.update(body + callbackUrl, 'utf8')
		.digest('base64');
}

function jiraSignature(body: string, secret: string): string {
	const hex = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
	return `sha256=${hex}`;
}

// ---------------------------------------------------------------------------
// verifyGitHubSignature
// ---------------------------------------------------------------------------

describe('verifyGitHubSignature', () => {
	const secret = 'my-github-secret';
	const body = '{"action":"opened","number":1}';

	it('returns true for a valid signature', () => {
		const sig = githubSignature(body, secret);
		expect(verifyGitHubSignature(body, sig, secret)).toBe(true);
	});

	it('returns false for an empty body with a signature for non-empty body', () => {
		const sig = githubSignature(body, secret);
		expect(verifyGitHubSignature('', sig, secret)).toBe(false);
	});

	it('returns true for an empty body when the signature matches the empty body', () => {
		const sig = githubSignature('', secret);
		expect(verifyGitHubSignature('', sig, secret)).toBe(true);
	});

	it('returns false when the signature is an empty string', () => {
		expect(verifyGitHubSignature(body, '', secret)).toBe(false);
	});

	it('returns false when the signature prefix is missing (raw hex only)', () => {
		const rawHex = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
		expect(verifyGitHubSignature(body, rawHex, secret)).toBe(false);
	});

	it('returns false when the signature uses the wrong prefix (sha1= instead of sha256=)', () => {
		const wrongPrefix = `sha1=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
		expect(verifyGitHubSignature(body, wrongPrefix, secret)).toBe(false);
	});

	it('returns false when signed with a different secret', () => {
		const sig = githubSignature(body, 'wrong-secret');
		expect(verifyGitHubSignature(body, sig, secret)).toBe(false);
	});

	it('returns false when the body has been tampered with', () => {
		const sig = githubSignature(body, secret);
		expect(verifyGitHubSignature(`${body}tampered`, sig, secret)).toBe(false);
	});

	it('returns false for a completely garbage signature string', () => {
		expect(verifyGitHubSignature(body, 'not-a-real-signature', secret)).toBe(false);
	});

	it('is timing-safe: the comparison does not short-circuit on length mismatch within prefix', () => {
		// Provide a correctly-prefixed but shorter hex to exercise the length branch
		expect(verifyGitHubSignature(body, 'sha256=abc', secret)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// verifyTrelloSignature
// ---------------------------------------------------------------------------

describe('verifyTrelloSignature', () => {
	const secret = 'trello-api-key';
	const body = '{"action":{"type":"createCard"}}';
	const callbackUrl = 'https://example.com/webhook/trello';

	it('returns true for a valid signature', () => {
		const sig = trelloSignature(body, callbackUrl, secret);
		expect(verifyTrelloSignature(body, callbackUrl, sig, secret)).toBe(true);
	});

	it('returns false when the signature is an empty string', () => {
		expect(verifyTrelloSignature(body, callbackUrl, '', secret)).toBe(false);
	});

	it('returns false when the body is empty and signature was built over non-empty body', () => {
		const sig = trelloSignature(body, callbackUrl, secret);
		expect(verifyTrelloSignature('', callbackUrl, sig, secret)).toBe(false);
	});

	it('returns true for an empty body when the signature matches the empty body', () => {
		const sig = trelloSignature('', callbackUrl, secret);
		expect(verifyTrelloSignature('', callbackUrl, sig, secret)).toBe(true);
	});

	it('returns false when signed with a different callback URL', () => {
		const sig = trelloSignature(body, 'https://other.example.com/webhook', secret);
		expect(verifyTrelloSignature(body, callbackUrl, sig, secret)).toBe(false);
	});

	it('returns false when signed with a different secret', () => {
		const sig = trelloSignature(body, callbackUrl, 'wrong-secret');
		expect(verifyTrelloSignature(body, callbackUrl, sig, secret)).toBe(false);
	});

	it('returns false when the body has been tampered with', () => {
		const sig = trelloSignature(body, callbackUrl, secret);
		expect(verifyTrelloSignature(`${body}tampered`, callbackUrl, sig, secret)).toBe(false);
	});

	it('returns false for a completely garbage signature string', () => {
		expect(verifyTrelloSignature(body, callbackUrl, 'not-base64!@#$', secret)).toBe(false);
	});

	it('includes callbackUrl in the HMAC input (different URL → different signature)', () => {
		const sig1 = trelloSignature(body, 'https://url-a.example.com', secret);
		const sig2 = trelloSignature(body, 'https://url-b.example.com', secret);
		expect(sig1).not.toBe(sig2);
	});
});

// ---------------------------------------------------------------------------
// verifyJiraSignature
// ---------------------------------------------------------------------------

describe('verifyJiraSignature', () => {
	const secret = 'my-jira-secret';
	const body = '{"webhookEvent":"jira:issue_updated","issue":{"key":"PROJ-1"}}';

	it('returns true for a valid signature', () => {
		const sig = jiraSignature(body, secret);
		expect(verifyJiraSignature(body, sig, secret)).toBe(true);
	});

	it('returns false for an empty body with a signature for non-empty body', () => {
		const sig = jiraSignature(body, secret);
		expect(verifyJiraSignature('', sig, secret)).toBe(false);
	});

	it('returns true for an empty body when the signature matches the empty body', () => {
		const sig = jiraSignature('', secret);
		expect(verifyJiraSignature('', sig, secret)).toBe(true);
	});

	it('returns false when the signature is an empty string', () => {
		expect(verifyJiraSignature(body, '', secret)).toBe(false);
	});

	it('returns false when the signature prefix is missing (raw hex only)', () => {
		const rawHex = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
		expect(verifyJiraSignature(body, rawHex, secret)).toBe(false);
	});

	it('returns false when signed with a different secret', () => {
		const sig = jiraSignature(body, 'wrong-secret');
		expect(verifyJiraSignature(body, sig, secret)).toBe(false);
	});

	it('returns false when the body has been tampered with', () => {
		const sig = jiraSignature(body, secret);
		expect(verifyJiraSignature(`${body}tampered`, sig, secret)).toBe(false);
	});

	it('returns false for a completely garbage signature string', () => {
		expect(verifyJiraSignature(body, 'not-a-real-signature', secret)).toBe(false);
	});

	it('is timing-safe: the comparison does not short-circuit on length mismatch within prefix', () => {
		// Provide a correctly-prefixed but shorter hex to exercise the length branch
		expect(verifyJiraSignature(body, 'sha256=abc', secret)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// verifySentrySignature
// ---------------------------------------------------------------------------

describe('verifySentrySignature', () => {
	const secret = 'my-sentry-secret';
	const body = '{"action":"triggered","data":{"event":{"title":"Error"}}}';

	function sentrySignature(b: string, s: string): string {
		return createHmac('sha256', s).update(b, 'utf8').digest('hex');
	}

	it('returns true for a valid signature', () => {
		const sig = sentrySignature(body, secret);
		expect(verifySentrySignature(body, sig, secret)).toBe(true);
	});

	it('returns false for an empty body with a signature for non-empty body', () => {
		const sig = sentrySignature(body, secret);
		expect(verifySentrySignature('', sig, secret)).toBe(false);
	});

	it('returns true for an empty body when the signature matches the empty body', () => {
		const sig = sentrySignature('', secret);
		expect(verifySentrySignature('', sig, secret)).toBe(true);
	});

	it('returns false when the signature is an empty string', () => {
		expect(verifySentrySignature(body, '', secret)).toBe(false);
	});

	it('returns false when the signature has an unexpected sha256= prefix (unlike GitHub format)', () => {
		const withPrefix = `sha256=${sentrySignature(body, secret)}`;
		expect(verifySentrySignature(body, withPrefix, secret)).toBe(false);
	});

	it('returns false when signed with a different secret', () => {
		const sig = sentrySignature(body, 'wrong-secret');
		expect(verifySentrySignature(body, sig, secret)).toBe(false);
	});

	it('returns false when the body has been tampered with', () => {
		const sig = sentrySignature(body, secret);
		expect(verifySentrySignature(`${body}tampered`, sig, secret)).toBe(false);
	});

	it('returns false for a completely garbage signature string', () => {
		expect(verifySentrySignature(body, 'not-a-real-signature', secret)).toBe(false);
	});

	it('is timing-safe: the comparison does not short-circuit on length mismatch', () => {
		expect(verifySentrySignature(body, 'abc', secret)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// verifyHmac — generic helper (edge cases)
// ---------------------------------------------------------------------------

describe('verifyHmac', () => {
	const secret = 'test-secret';
	const body = 'hello world';

	// Helper: compute a valid HMAC for the test body using sha256/hex/no-prefix
	function hmacHex(data: string, s: string): string {
		return createHmac('sha256', s).update(data, 'utf8').digest('hex');
	}

	it('returns true for a valid sha256/hex/no-prefix signature', () => {
		const sig = hmacHex(body, secret);
		expect(
			verifyHmac({ algorithm: 'sha256', data: body, secret, signature: sig, encoding: 'hex' }),
		).toBe(true);
	});

	it('returns true for a valid sha256/hex/prefix signature', () => {
		const sig = `sha256=${hmacHex(body, secret)}`;
		expect(
			verifyHmac({
				algorithm: 'sha256',
				data: body,
				secret,
				signature: sig,
				encoding: 'hex',
				prefix: 'sha256=',
			}),
		).toBe(true);
	});

	it('returns false when signature is an empty string', () => {
		expect(
			verifyHmac({ algorithm: 'sha256', data: body, secret, signature: '', encoding: 'hex' }),
		).toBe(false);
	});

	it('returns false when prefix is required but missing from signature', () => {
		// Raw hex without the sha256= prefix
		const rawHex = hmacHex(body, secret);
		expect(
			verifyHmac({
				algorithm: 'sha256',
				data: body,
				secret,
				signature: rawHex,
				encoding: 'hex',
				prefix: 'sha256=',
			}),
		).toBe(false);
	});

	it('returns false when prefix is wrong (sha1= instead of sha256=)', () => {
		const wrongPrefix = `sha1=${hmacHex(body, secret)}`;
		expect(
			verifyHmac({
				algorithm: 'sha256',
				data: body,
				secret,
				signature: wrongPrefix,
				encoding: 'hex',
				prefix: 'sha256=',
			}),
		).toBe(false);
	});

	it('returns false when length differs (correctly-prefixed but truncated hex)', () => {
		expect(
			verifyHmac({
				algorithm: 'sha256',
				data: body,
				secret,
				signature: 'sha256=abc',
				encoding: 'hex',
				prefix: 'sha256=',
			}),
		).toBe(false);
	});

	it('returns false when the secret is wrong', () => {
		const sig = hmacHex(body, 'wrong-secret');
		expect(
			verifyHmac({ algorithm: 'sha256', data: body, secret, signature: sig, encoding: 'hex' }),
		).toBe(false);
	});

	it('returns false when the data has been tampered with', () => {
		const sig = hmacHex(body, secret);
		expect(
			verifyHmac({
				algorithm: 'sha256',
				data: `${body}tampered`,
				secret,
				signature: sig,
				encoding: 'hex',
			}),
		).toBe(false);
	});

	it('supports sha1/base64 (Trello algorithm)', () => {
		const sig = createHmac('sha1', secret).update(body, 'utf8').digest('base64');
		expect(
			verifyHmac({ algorithm: 'sha1', data: body, secret, signature: sig, encoding: 'base64' }),
		).toBe(true);
	});

	it('returns false for a completely garbage signature string', () => {
		expect(
			verifyHmac({
				algorithm: 'sha256',
				data: body,
				secret,
				signature: 'not-a-signature!',
				encoding: 'hex',
			}),
		).toBe(false);
	});
});
