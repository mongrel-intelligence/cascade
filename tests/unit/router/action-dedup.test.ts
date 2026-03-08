import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clearActionRecords,
	isDuplicateAction,
	markActionProcessed,
} from '../../../src/router/action-dedup.js';

describe('action-dedup', () => {
	beforeEach(() => {
		clearActionRecords();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('isDuplicateAction', () => {
		it('returns false for first call with an action ID', () => {
			expect(isDuplicateAction('action-123')).toBe(false);
		});

		it('returns true for subsequent calls with the same action ID within TTL', () => {
			markActionProcessed('action-123');
			expect(isDuplicateAction('action-123')).toBe(true);
		});

		it('returns false after TTL expires (60 seconds)', () => {
			vi.useFakeTimers();
			markActionProcessed('action-123');

			// Still a duplicate within TTL
			vi.advanceTimersByTime(59 * 1000);
			expect(isDuplicateAction('action-123')).toBe(true);

			// TTL expired (60s + 1ms)
			vi.advanceTimersByTime(1001);
			expect(isDuplicateAction('action-123')).toBe(false);
		});

		it('returns false for different action IDs', () => {
			markActionProcessed('action-123');
			expect(isDuplicateAction('action-456')).toBe(false);
		});
	});

	describe('markActionProcessed', () => {
		it('marks an action ID as processed', () => {
			expect(isDuplicateAction('action-789')).toBe(false);
			markActionProcessed('action-789');
			expect(isDuplicateAction('action-789')).toBe(true);
		});

		it('cleans up old entries when map grows large', () => {
			vi.useFakeTimers();

			// Add entries that will be expired
			for (let i = 0; i < 500; i++) {
				markActionProcessed(`old-action-${i}`);
			}

			// Advance time past TTL
			vi.advanceTimersByTime(61 * 1000);

			// Add more entries to trigger cleanup (total > 1000)
			for (let i = 0; i < 501; i++) {
				markActionProcessed(`new-action-${i}`);
			}

			// Old entries should have been cleaned up (checking a few)
			expect(isDuplicateAction('old-action-0')).toBe(false);
			expect(isDuplicateAction('old-action-100')).toBe(false);

			// New entries should still be tracked
			expect(isDuplicateAction('new-action-0')).toBe(true);
			expect(isDuplicateAction('new-action-500')).toBe(true);
		});
	});

	describe('clearActionRecords', () => {
		it('clears all action records', () => {
			markActionProcessed('action-1');
			markActionProcessed('action-2');
			markActionProcessed('action-3');

			expect(isDuplicateAction('action-1')).toBe(true);
			expect(isDuplicateAction('action-2')).toBe(true);

			clearActionRecords();

			expect(isDuplicateAction('action-1')).toBe(false);
			expect(isDuplicateAction('action-2')).toBe(false);
			expect(isDuplicateAction('action-3')).toBe(false);
		});
	});

	describe('distinct action IDs', () => {
		it('does not deduplicate distinct action IDs', () => {
			markActionProcessed('trello-action-abc');
			markActionProcessed('trello-action-def');
			markActionProcessed('trello-action-ghi');

			// Each distinct action is independently tracked
			expect(isDuplicateAction('trello-action-abc')).toBe(true);
			expect(isDuplicateAction('trello-action-def')).toBe(true);
			expect(isDuplicateAction('trello-action-ghi')).toBe(true);

			// A new action should not be considered a duplicate
			expect(isDuplicateAction('trello-action-xyz')).toBe(false);
		});
	});
});
