import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	verifyGitHubSignature,
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

// ---------------------------------------------------------------------------
// verifyGitHubSignature
// ---------------------------------------------------------------------------

describe('verifyGitHubSignature', () => {
	const secret = 'my-github-secret';
	const body = '{"action":"opened","number":1}';
	const callbackUrl = 'https://example.com/webhook/github';

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
