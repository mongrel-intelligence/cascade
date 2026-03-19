import { describe, expect, it } from 'vitest';
import { buildTextPrEvidence } from '../../../src/backends/shared/resultBuilder.js';

describe('buildTextPrEvidence', () => {
	it('returns a text evidence object when prUrl is a non-empty string', () => {
		const result = buildTextPrEvidence('https://github.com/owner/repo/pull/42');
		expect(result).toEqual({ source: 'text', authoritative: false });
	});

	it('returns source "text" (as const)', () => {
		const result = buildTextPrEvidence('https://github.com/owner/repo/pull/1');
		expect(result?.source).toBe('text');
	});

	it('returns authoritative: false', () => {
		const result = buildTextPrEvidence('https://github.com/owner/repo/pull/1');
		expect(result?.authoritative).toBe(false);
	});

	it('returns undefined when prUrl is undefined', () => {
		const result = buildTextPrEvidence(undefined);
		expect(result).toBeUndefined();
	});

	it('returns undefined when prUrl is null', () => {
		const result = buildTextPrEvidence(null);
		expect(result).toBeUndefined();
	});

	it('returns undefined when prUrl is an empty string', () => {
		const result = buildTextPrEvidence('');
		expect(result).toBeUndefined();
	});

	it('does not include a command property', () => {
		const result = buildTextPrEvidence('https://github.com/owner/repo/pull/7');
		expect(result).not.toHaveProperty('command');
	});
});
