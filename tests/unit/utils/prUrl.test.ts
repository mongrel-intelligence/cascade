import { describe, expect, it } from 'vitest';
import { extractPRUrl } from '../../../src/utils/prUrl.js';

describe('extractPRUrl', () => {
	it('extracts GitHub PR URL from text', () => {
		const text = 'Created PR: https://github.com/owner/repo/pull/123';
		expect(extractPRUrl(text)).toBe('https://github.com/owner/repo/pull/123');
	});

	it('extracts PR URL with trailing punctuation', () => {
		const text = 'See https://github.com/owner/repo/pull/456.';
		expect(extractPRUrl(text)).toBe('https://github.com/owner/repo/pull/456');
	});

	it('extracts PR URL surrounded by quotes', () => {
		const text = 'Link: "https://github.com/owner/repo/pull/789"';
		expect(extractPRUrl(text)).toBe('https://github.com/owner/repo/pull/789');
	});

	it('extracts PR URL in parentheses', () => {
		const text = 'Check (https://github.com/owner/repo/pull/999)';
		expect(extractPRUrl(text)).toBe('https://github.com/owner/repo/pull/999');
	});

	it('extracts PR URL in markdown link', () => {
		const text = '[PR](https://github.com/owner/repo/pull/111)';
		expect(extractPRUrl(text)).toBe('https://github.com/owner/repo/pull/111');
	});

	it('extracts first PR URL when multiple are present', () => {
		const text =
			'First: https://github.com/owner/repo/pull/1 Second: https://github.com/owner/repo/pull/2';
		expect(extractPRUrl(text)).toBe('https://github.com/owner/repo/pull/1');
	});

	it('returns undefined for non-PR GitHub URLs', () => {
		expect(extractPRUrl('https://github.com/owner/repo')).toBeUndefined();
		expect(extractPRUrl('https://github.com/owner/repo/issues/123')).toBeUndefined();
	});

	it('returns undefined when no URL present', () => {
		expect(extractPRUrl('No URL here')).toBeUndefined();
		expect(extractPRUrl('')).toBeUndefined();
	});

	it('handles URLs with hyphenated owner and repo names', () => {
		const text = 'PR: https://github.com/my-org/my-repo/pull/42';
		expect(extractPRUrl(text)).toBe('https://github.com/my-org/my-repo/pull/42');
	});

	it('handles URLs with underscores in names', () => {
		const text = 'PR: https://github.com/my_org/my_repo/pull/100';
		expect(extractPRUrl(text)).toBe('https://github.com/my_org/my_repo/pull/100');
	});
});
