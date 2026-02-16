import { describe, expect, it } from 'vitest';
import { extractPRUrl } from '../../../src/utils/prUrl.js';

describe('extractPRUrl', () => {
	it('extracts PR URL from plain text', () => {
		const text = 'Created PR: https://github.com/owner/repo/pull/123';
		expect(extractPRUrl(text)).toBe('https://github.com/owner/repo/pull/123');
	});

	it('extracts PR URL with surrounding text', () => {
		const text = 'The PR is available at https://github.com/owner/repo/pull/456 for review.';
		expect(extractPRUrl(text)).toBe('https://github.com/owner/repo/pull/456');
	});

	it('stops at quotes', () => {
		const text = '"https://github.com/owner/repo/pull/789"';
		expect(extractPRUrl(text)).toBe('https://github.com/owner/repo/pull/789');
	});

	it('stops at closing parenthesis', () => {
		const text = '(https://github.com/owner/repo/pull/101)';
		expect(extractPRUrl(text)).toBe('https://github.com/owner/repo/pull/101');
	});

	it('stops at closing bracket', () => {
		const text = '[PR](https://github.com/owner/repo/pull/202)';
		expect(extractPRUrl(text)).toBe('https://github.com/owner/repo/pull/202');
	});

	it('returns undefined when no URL present', () => {
		expect(extractPRUrl('No PR URL here')).toBeUndefined();
	});

	it('returns undefined for malformed URL', () => {
		expect(extractPRUrl('https://github.com/owner/repo')).toBeUndefined();
	});

	it('extracts first URL when multiple present', () => {
		const text =
			'PR 1: https://github.com/owner/repo/pull/1 PR 2: https://github.com/owner/repo/pull/2';
		expect(extractPRUrl(text)).toBe('https://github.com/owner/repo/pull/1');
	});

	it('handles URLs with hyphens and underscores in owner/repo', () => {
		const text = 'https://github.com/my-org/my_repo/pull/999';
		expect(extractPRUrl(text)).toBe('https://github.com/my-org/my_repo/pull/999');
	});
});
