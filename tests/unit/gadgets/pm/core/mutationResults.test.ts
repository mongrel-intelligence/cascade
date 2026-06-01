import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	abortedResult,
	currentTimestamp,
	noOpResult,
	okResult,
	type PMMutationResult,
	pickTimestamp,
} from '../../../../../src/gadgets/pm/core/mutationResults.js';

const FROZEN_NOW = new Date('2026-03-15T12:34:56.789Z');

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(FROZEN_NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('PM mutationResults', () => {
	describe('currentTimestamp', () => {
		it('returns the current ISO timestamp', () => {
			expect(currentTimestamp()).toBe(FROZEN_NOW.toISOString());
		});
	});

	describe('pickTimestamp', () => {
		it('prefers the provider timestamp when present', () => {
			expect(pickTimestamp('2025-12-01T01:02:03.000Z')).toBe('2025-12-01T01:02:03.000Z');
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
		it('uses the provider timestamp on the ok result', () => {
			const result: PMMutationResult = okResult({
				id: 'item-1',
				updatedAt: '2025-12-01T01:02:03.000Z',
				url: 'https://trello.com/c/item-1',
			});
			expect(result).toEqual({
				id: 'item-1',
				status: 'ok',
				updatedAt: '2025-12-01T01:02:03.000Z',
				url: 'https://trello.com/c/item-1',
			});
		});

		it('rejects an empty provider timestamp', () => {
			expect(() => okResult({ id: 'item-1', updatedAt: '' })).toThrow(
				'okResult requires a provider-supplied updatedAt timestamp',
			);
		});

		it('rejects a missing provider timestamp at runtime', () => {
			expect(() => okResult({ id: 'item-1' } as Parameters<typeof okResult>[0])).toThrow(
				'okResult requires a provider-supplied updatedAt timestamp',
			);
		});

		it('omits optional fields when not provided', () => {
			const result = okResult({ id: 'item-1', updatedAt: '2025-12-01T01:02:03.000Z' });
			expect(result.url).toBeUndefined();
			expect(result.message).toBeUndefined();
		});

		it('includes the message when provided', () => {
			const result = okResult({
				id: 'item-1',
				updatedAt: '2025-12-01T01:02:03.000Z',
				message: 'Updated title',
			});
			expect(result.message).toBe('Updated title');
		});
	});

	describe('noOpResult', () => {
		it('uses the current ISO timestamp', () => {
			const result = noOpResult({
				id: 'item-1',
				message: 'already in destination state',
				url: 'https://trello.com/c/item-1',
			});
			expect(result).toEqual({
				id: 'item-1',
				status: 'no-op',
				updatedAt: FROZEN_NOW.toISOString(),
				url: 'https://trello.com/c/item-1',
				message: 'already in destination state',
			});
		});

		it('never accepts a provider timestamp (synthetic outcome)', () => {
			// Type-level guard: noOpResult signature omits updatedAt. Calling
			// with one would be a compile error. This test pins the runtime
			// behavior — the result always carries the current ISO timestamp.
			const result = noOpResult({ id: 'item-1' });
			expect(result.updatedAt).toBe(FROZEN_NOW.toISOString());
		});
	});

	describe('abortedResult', () => {
		it('uses the current ISO timestamp', () => {
			const result = abortedResult({
				id: 'item-1',
				message: 'expected source state mismatch',
			});
			expect(result).toEqual({
				id: 'item-1',
				status: 'aborted',
				updatedAt: FROZEN_NOW.toISOString(),
				message: 'expected source state mismatch',
			});
		});

		it('omits optional fields when not provided', () => {
			const result = abortedResult({ id: 'item-1' });
			expect(result.url).toBeUndefined();
			expect(result.message).toBeUndefined();
		});
	});

	describe('status union exhaustiveness', () => {
		// This test is a discriminator-coverage guard: it pins that the three
		// helper builders cover every status union member. Adding a new
		// status without a matching helper here surfaces as an unused
		// literal at compile time.
		it('covers every PMMutationStatus member', () => {
			const ok = okResult({ id: 'a', updatedAt: '2025-12-01T00:00:00.000Z' });
			const noop = noOpResult({ id: 'b' });
			const aborted = abortedResult({ id: 'c' });
			const statuses: Array<'ok' | 'no-op' | 'aborted'> = [ok.status, noop.status, aborted.status];
			expect(new Set(statuses)).toEqual(new Set(['ok', 'no-op', 'aborted']));
		});
	});
});
