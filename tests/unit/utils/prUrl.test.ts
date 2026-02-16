import { describe, expect, it } from 'vitest';
import { extractPRUrl } from '../../../src/utils/prUrl.js';

describe('extractPRUrl', () => {
	it('extracts plain PR URL from text', () => {
		const text = 'Created PR: https://github.com/owner/repo/pull/123';
		expect(extractPRUrl(text)).toBe('https://github.com/owner/repo/pull/123');
	});

	it('extracts PR URL in quotes', () => {
		const text = 'PR created: "https://github.com/owner/repo/pull/456"';
		expect(extractPRUrl(text)).toBe('https://github.com/owner/repo/pull/456');
	});

	it('extracts PR URL in single quotes', () => {
		const text = "PR at 'https://github.com/owner/repo/pull/789'";
		expect(extractPRUrl(text)).toBe('https://github.com/owner/repo/pull/789');
	});

	it('extracts PR URL in parentheses', () => {
		const text = 'See (https://github.com/owner/repo/pull/101)';
		expect(extractPRUrl(text)).toBe('https://github.com/owner/repo/pull/101');
	});

	it('extracts PR URL in brackets', () => {
		const text = '[PR link](https://github.com/owner/repo/pull/202)';
		expect(extractPRUrl(text)).toBe('https://github.com/owner/repo/pull/202');
	});

	it('returns undefined when no PR URL found', () => {
		const text = 'No PR here';
		expect(extractPRUrl(text)).toBeUndefined();
	});

	it('returns undefined for invalid URLs', () => {
		const text = 'https://example.com/pull/123';
		expect(extractPRUrl(text)).toBeUndefined();
	});

	it('extracts first PR URL when multiple present', () => {
		const text =
			'First: https://github.com/owner/repo/pull/1 Second: https://github.com/owner/repo/pull/2';
		expect(extractPRUrl(text)).toBe('https://github.com/owner/repo/pull/1');
	});

	it('handles multi-line text', () => {
		const text = `Line 1
Line 2 with PR: https://github.com/owner/repo/pull/999
Line 3`;
		expect(extractPRUrl(text)).toBe('https://github.com/owner/repo/pull/999');
	});
});
