import { describe, expect, it } from 'vitest';

import { extractPRNumber, extractPRUrl } from '../../../src/utils/prUrl.js';

describe.concurrent('extractPRUrl', () => {
	it('extracts a GitHub PR URL from plain text', () => {
		const text = 'Created PR: https://github.com/owner/repo/pull/42';
		expect(extractPRUrl(text)).toBe('https://github.com/owner/repo/pull/42');
	});

	it('extracts a PR URL when surrounded by other text', () => {
		const text = 'Done! See https://github.com/acme/cascade/pull/123 for details.';
		expect(extractPRUrl(text)).toBe('https://github.com/acme/cascade/pull/123');
	});

	it('returns undefined when no PR URL is present', () => {
		expect(extractPRUrl('No URLs here.')).toBeUndefined();
	});

	it('returns undefined for non-PR GitHub URLs', () => {
		const text = 'Check https://github.com/owner/repo/issues/5 for context';
		expect(extractPRUrl(text)).toBeUndefined();
	});

	it('extracts the first PR URL when multiple are present', () => {
		const text = 'First: https://github.com/a/b/pull/1 and second: https://github.com/c/d/pull/2';
		expect(extractPRUrl(text)).toBe('https://github.com/a/b/pull/1');
	});

	it('extracts a PR URL when followed by a period (end of sentence)', () => {
		// The regex stops at \d+ so the trailing period is not included
		const text = 'See https://github.com/owner/repo/pull/42.';
		const url = extractPRUrl(text);
		expect(url).toBe('https://github.com/owner/repo/pull/42');
	});

	it('returns undefined for empty string', () => {
		expect(extractPRUrl('')).toBeUndefined();
	});

	it('handles URLs in JSON output', () => {
		const json = JSON.stringify({ prUrl: 'https://github.com/org/repo/pull/99', success: true });
		// In JSON, URL is surrounded by quotes which are excluded by the regex
		expect(extractPRUrl(json)).toBe('https://github.com/org/repo/pull/99');
	});
});

describe.concurrent('extractPRNumber', () => {
	it('extracts PR number from a full GitHub PR URL', () => {
		expect(extractPRNumber('https://github.com/owner/repo/pull/42')).toBe(42);
	});

	it('extracts PR number from text containing a PR path', () => {
		expect(extractPRNumber('Created /pull/123 successfully')).toBe(123);
	});

	it('returns undefined when no PR path is present', () => {
		expect(extractPRNumber('No PR here')).toBeUndefined();
	});

	it('returns undefined for empty string', () => {
		expect(extractPRNumber('')).toBeUndefined();
	});

	it('extracts the first PR number when multiple are present', () => {
		expect(extractPRNumber('/pull/1 and /pull/2')).toBe(1);
	});
});
