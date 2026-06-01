import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	abortedResult,
	currentTimestamp,
	type GitHubMutationResult,
	noOpResult,
	okResult,
	pickTimestamp,
} from '../../../../../src/gadgets/github/core/mutationResults.js';

const FROZEN_NOW = new Date('2026-03-15T12:34:56.789Z');

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(FROZEN_NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('GitHub mutationResults', () => {
	describe('currentTimestamp', () => {
		it('returns the current ISO timestamp', () => {
			expect(currentTimestamp()).toBe(FROZEN_NOW.toISOString());
		});
	});

	describe('pickTimestamp', () => {
		it('prefers the GitHub-supplied timestamp', () => {
			expect(pickTimestamp('2025-12-01T01:02:03Z')).toBe('2025-12-01T01:02:03Z');
		});

		it('falls back to the current ISO timestamp when undefined', () => {
			expect(pickTimestamp(undefined)).toBe(FROZEN_NOW.toISOString());
		});

		it('falls back when the provider value is null', () => {
			expect(pickTimestamp(null)).toBe(FROZEN_NOW.toISOString());
		});

		it('falls back when the provider value is the empty string', () => {
			expect(pickTimestamp('')).toBe(FROZEN_NOW.toISOString());
		});
	});

	describe('okResult', () => {
		it('preserves the GitHub timestamp and stringifies numeric ids', () => {
			const result: GitHubMutationResult = okResult({
				id: 4242,
				updatedAt: '2025-12-01T01:02:03Z',
				url: 'https://github.com/o/r/pull/42',
			});
			expect(result).toEqual({
				id: '4242',
				status: 'ok',
				updatedAt: '2025-12-01T01:02:03Z',
				url: 'https://github.com/o/r/pull/42',
			});
		});

		it('accepts string ids unchanged', () => {
			const result = okResult({ id: 'gh-comment-id', updatedAt: '2025-12-01T01:02:03Z' });
			expect(result.id).toBe('gh-comment-id');
		});

		it('synthesises the timestamp when none is supplied', () => {
			const result = okResult({ id: 1 });
			expect(result.updatedAt).toBe(FROZEN_NOW.toISOString());
			expect(result.status).toBe('ok');
		});

		it('omits optional fields when not provided', () => {
			const result = okResult({ id: 1, updatedAt: '2025-12-01T01:02:03Z' });
			expect(result.url).toBeUndefined();
			expect(result.message).toBeUndefined();
		});
	});

	describe('noOpResult', () => {
		it('uses the current ISO timestamp', () => {
			const result = noOpResult({
				id: 99,
				message: 'PR already exists for this branch',
				url: 'https://github.com/o/r/pull/99',
			});
			expect(result).toEqual({
				id: '99',
				status: 'no-op',
				updatedAt: FROZEN_NOW.toISOString(),
				url: 'https://github.com/o/r/pull/99',
				message: 'PR already exists for this branch',
			});
		});
	});

	describe('abortedResult', () => {
		it('uses the current ISO timestamp', () => {
			const result = abortedResult({
				id: 'comment-1',
				message: 'expected author mismatch',
			});
			expect(result).toEqual({
				id: 'comment-1',
				status: 'aborted',
				updatedAt: FROZEN_NOW.toISOString(),
				message: 'expected author mismatch',
			});
		});

		it('omits optional fields when not provided', () => {
			const result = abortedResult({ id: 1 });
			expect(result.url).toBeUndefined();
			expect(result.message).toBeUndefined();
		});
	});

	describe('status union exhaustiveness', () => {
		it('covers every GitHubMutationStatus member', () => {
			const ok = okResult({ id: 1, updatedAt: '2025-12-01T00:00:00Z' });
			const noop = noOpResult({ id: 2 });
			const aborted = abortedResult({ id: 3 });
			expect(new Set([ok.status, noop.status, aborted.status])).toEqual(
				new Set(['ok', 'no-op', 'aborted']),
			);
		});
	});
});
