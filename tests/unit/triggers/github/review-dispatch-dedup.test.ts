import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import {
	buildReviewDispatchKey,
	claimReviewDispatch,
	recentlyDispatched,
	releaseReviewDispatch,
} from '../../../../src/triggers/github/review-dispatch-dedup.js';
import { logger } from '../../../../src/utils/logging.js';

const mockLogger = vi.mocked(logger);

const DEDUP_TTL_MS = 30 * 60 * 1000; // 30 minutes

describe('buildReviewDispatchKey', () => {
	it('returns correct format owner/repo:prNumber:headSha', () => {
		const key = buildReviewDispatchKey('myorg', 'myrepo', 42, 'abc123def456');
		expect(key).toBe('myorg/myrepo:42:abc123def456');
	});

	it('includes all four components in the returned key', () => {
		const key = buildReviewDispatchKey('acme', 'widget', 99, 'deadbeef');
		expect(key).toContain('acme/widget');
		expect(key).toContain(':99:');
		expect(key).toContain('deadbeef');
	});

	it('separates owner and repo with a slash and appends prNumber and headSha with colons', () => {
		const key = buildReviewDispatchKey('owner', 'repo', 1, 'sha');
		expect(key).toBe('owner/repo:1:sha');
	});
});

describe('claimReviewDispatch', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		recentlyDispatched.clear();
	});

	afterEach(() => {
		recentlyDispatched.clear();
		vi.useRealTimers();
	});

	it('returns true on the first claim for a key', () => {
		const key = buildReviewDispatchKey('acme', 'repo', 1, 'sha1');
		const result = claimReviewDispatch(key, 'check-suite-success', {
			prNumber: 1,
			headSha: 'sha1',
		});
		expect(result).toBe(true);
	});

	it('returns false on a duplicate claim for the same key', () => {
		const key = buildReviewDispatchKey('acme', 'repo', 1, 'sha1');
		claimReviewDispatch(key, 'check-suite-success', { prNumber: 1, headSha: 'sha1' });
		const result = claimReviewDispatch(key, 'check-suite-success', {
			prNumber: 1,
			headSha: 'sha1',
		});
		expect(result).toBe(false);
	});

	it('returns true for a different key (no cross-key interference)', () => {
		const key1 = buildReviewDispatchKey('acme', 'repo', 1, 'sha1');
		const key2 = buildReviewDispatchKey('acme', 'repo', 2, 'sha2');

		claimReviewDispatch(key1, 'check-suite-success', { prNumber: 1, headSha: 'sha1' });
		const result = claimReviewDispatch(key2, 'check-suite-success', {
			prNumber: 2,
			headSha: 'sha2',
		});
		expect(result).toBe(true);
	});

	it('logs info with dispatch key when claim is successful', () => {
		const key = buildReviewDispatchKey('acme', 'repo', 5, 'sha5');
		claimReviewDispatch(key, 'review-requested', { prNumber: 5, headSha: 'sha5' });

		expect(mockLogger.info).toHaveBeenCalledWith(
			'Claimed review dispatch for PR+SHA',
			expect.objectContaining({
				trigger: 'review-requested',
				reviewDispatchKey: key,
				prNumber: 5,
				headSha: 'sha5',
			}),
		);
	});

	it('logs info with dispatch key when claim is a duplicate', () => {
		const key = buildReviewDispatchKey('acme', 'repo', 7, 'sha7');
		claimReviewDispatch(key, 'check-suite-success', { prNumber: 7, headSha: 'sha7' });
		claimReviewDispatch(key, 'check-suite-success', { prNumber: 7, headSha: 'sha7' });

		expect(mockLogger.info).toHaveBeenCalledWith(
			'Review already dispatched for this PR+SHA, skipping',
			expect.objectContaining({
				trigger: 'check-suite-success',
				reviewDispatchKey: key,
				prNumber: 7,
				headSha: 'sha7',
			}),
		);
	});

	it('TTL expiration: a previously claimed key can be reclaimed after 30+ minutes', () => {
		const key = buildReviewDispatchKey('acme', 'repo', 10, 'sha10');
		claimReviewDispatch(key, 'check-suite-success', { prNumber: 10, headSha: 'sha10' });

		// Advance time past the TTL
		vi.advanceTimersByTime(DEDUP_TTL_MS + 1);

		const result = claimReviewDispatch(key, 'check-suite-success', {
			prNumber: 10,
			headSha: 'sha10',
		});
		expect(result).toBe(true);
	});

	it('does not expire a key before the TTL has elapsed', () => {
		const key = buildReviewDispatchKey('acme', 'repo', 11, 'sha11');
		claimReviewDispatch(key, 'check-suite-success', { prNumber: 11, headSha: 'sha11' });

		// Advance time to just before the TTL
		vi.advanceTimersByTime(DEDUP_TTL_MS - 1);

		const result = claimReviewDispatch(key, 'check-suite-success', {
			prNumber: 11,
			headSha: 'sha11',
		});
		expect(result).toBe(false);
	});

	it('cleanupExpiredEntries removes stale entries when claimReviewDispatch is called', () => {
		const key1 = buildReviewDispatchKey('acme', 'repo', 20, 'sha20');
		const key2 = buildReviewDispatchKey('acme', 'repo', 21, 'sha21');

		claimReviewDispatch(key1, 'check-suite-success', { prNumber: 20, headSha: 'sha20' });

		// Advance time past the TTL so key1 becomes stale
		vi.advanceTimersByTime(DEDUP_TTL_MS + 1);

		// Claiming key2 triggers cleanupExpiredEntries which should remove key1
		claimReviewDispatch(key2, 'check-suite-success', { prNumber: 21, headSha: 'sha21' });

		expect(recentlyDispatched.has(key1)).toBe(false);
		expect(recentlyDispatched.has(key2)).toBe(true);
	});
});

describe('releaseReviewDispatch', () => {
	beforeEach(() => {
		recentlyDispatched.clear();
	});

	afterEach(() => {
		recentlyDispatched.clear();
	});

	it('removes a claimed key so it can be reclaimed immediately', () => {
		const key = buildReviewDispatchKey('acme', 'repo', 30, 'sha30');
		claimReviewDispatch(key, 'check-suite-success', { prNumber: 30, headSha: 'sha30' });

		releaseReviewDispatch(key);

		const result = claimReviewDispatch(key, 'check-suite-success', {
			prNumber: 30,
			headSha: 'sha30',
		});
		expect(result).toBe(true);
	});

	it('is a no-op for a key that was never claimed', () => {
		const key = buildReviewDispatchKey('acme', 'repo', 31, 'sha31');
		// Should not throw
		expect(() => releaseReviewDispatch(key)).not.toThrow();
		expect(recentlyDispatched.has(key)).toBe(false);
	});

	it('only removes the specified key, leaving others intact', () => {
		const key1 = buildReviewDispatchKey('acme', 'repo', 40, 'sha40');
		const key2 = buildReviewDispatchKey('acme', 'repo', 41, 'sha41');

		claimReviewDispatch(key1, 'check-suite-success', { prNumber: 40, headSha: 'sha40' });
		claimReviewDispatch(key2, 'check-suite-success', { prNumber: 41, headSha: 'sha41' });

		releaseReviewDispatch(key1);

		expect(recentlyDispatched.has(key1)).toBe(false);
		expect(recentlyDispatched.has(key2)).toBe(true);
	});
});
