import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	MAX_ATTEMPTS,
	WINDOW_MS,
	_resetForTesting,
	_runCleanup,
	checkRateLimit,
	rateLimitStore,
	recordSuccessfulLogin,
} from '../../../../src/api/auth/rateLimiter.js';

describe('rateLimiter', () => {
	beforeEach(() => {
		_resetForTesting();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		_resetForTesting();
	});

	describe('checkRateLimit — under the limit', () => {
		it('allows the first attempt from a new IP', () => {
			const result = checkRateLimit('1.2.3.4');
			expect(result).toEqual({ limited: false });
		});

		it('allows attempts up to MAX_ATTEMPTS without blocking', () => {
			for (let i = 0; i < MAX_ATTEMPTS; i++) {
				const result = checkRateLimit('1.2.3.4');
				expect(result).toEqual({ limited: false });
			}
		});

		it('tracks attempt counts per IP independently', () => {
			for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
				checkRateLimit('1.1.1.1');
			}
			// Different IP should still be under limit
			const result = checkRateLimit('2.2.2.2');
			expect(result).toEqual({ limited: false });
		});
	});

	describe('checkRateLimit — at and over the limit', () => {
		it('blocks the (MAX_ATTEMPTS + 1)th attempt from the same IP', () => {
			for (let i = 0; i < MAX_ATTEMPTS; i++) {
				checkRateLimit('1.2.3.4');
			}
			const result = checkRateLimit('1.2.3.4');
			expect(result).toMatchObject({ limited: true });
		});

		it('returns retryAfterSeconds close to the window length on first block', () => {
			for (let i = 0; i < MAX_ATTEMPTS; i++) {
				checkRateLimit('1.2.3.4');
			}
			const result = checkRateLimit('1.2.3.4');
			expect(result.limited).toBe(true);
			if (result.limited) {
				// retryAfterSeconds should be <= ceil(WINDOW_MS / 1000)
				expect(result.retryAfterSeconds).toBeGreaterThan(0);
				expect(result.retryAfterSeconds).toBeLessThanOrEqual(WINDOW_MS / 1000);
			}
		});

		it('continues blocking subsequent requests after the limit is reached', () => {
			for (let i = 0; i < MAX_ATTEMPTS + 5; i++) {
				checkRateLimit('1.2.3.4');
			}
			const result = checkRateLimit('1.2.3.4');
			expect(result).toMatchObject({ limited: true });
		});
	});

	describe('checkRateLimit — window reset', () => {
		it('allows requests again after the window expires', () => {
			for (let i = 0; i < MAX_ATTEMPTS; i++) {
				checkRateLimit('1.2.3.4');
			}
			// Advance past the window
			vi.advanceTimersByTime(WINDOW_MS + 1);

			const result = checkRateLimit('1.2.3.4');
			expect(result).toEqual({ limited: false });
		});

		it('resets the count when the window expires', () => {
			for (let i = 0; i < MAX_ATTEMPTS; i++) {
				checkRateLimit('1.2.3.4');
			}
			vi.advanceTimersByTime(WINDOW_MS + 1);

			// Should be able to make MAX_ATTEMPTS new attempts in the fresh window
			for (let i = 0; i < MAX_ATTEMPTS; i++) {
				const result = checkRateLimit('1.2.3.4');
				expect(result).toEqual({ limited: false });
			}
		});
	});

	describe('recordSuccessfulLogin', () => {
		it('resets the rate-limit counter so subsequent attempts are allowed', () => {
			// Exhaust the limit
			for (let i = 0; i < MAX_ATTEMPTS; i++) {
				checkRateLimit('1.2.3.4');
			}
			expect(checkRateLimit('1.2.3.4')).toMatchObject({ limited: true });

			// Successful login clears the entry
			recordSuccessfulLogin('1.2.3.4');

			// Now the same IP should be allowed again
			const result = checkRateLimit('1.2.3.4');
			expect(result).toEqual({ limited: false });
		});

		it('does not affect other IPs when called', () => {
			for (let i = 0; i < MAX_ATTEMPTS; i++) {
				checkRateLimit('1.1.1.1');
				checkRateLimit('2.2.2.2');
			}

			recordSuccessfulLogin('1.1.1.1');

			// IP 1 should be cleared
			expect(checkRateLimit('1.1.1.1')).toEqual({ limited: false });
			// IP 2 should still be blocked
			expect(checkRateLimit('2.2.2.2')).toMatchObject({ limited: true });
		});

		it('is a no-op for an IP that has no entry', () => {
			expect(() => recordSuccessfulLogin('9.9.9.9')).not.toThrow();
		});
	});

	describe('cleanup — memory leak prevention', () => {
		it('removes expired entries when cleanup runs', () => {
			checkRateLimit('1.2.3.4');
			expect(rateLimitStore.size).toBe(1);

			// Advance past the window so the entry is expired
			vi.advanceTimersByTime(WINDOW_MS + 1);
			_runCleanup();

			expect(rateLimitStore.size).toBe(0);
		});

		it('does not remove entries that are still within their window', () => {
			checkRateLimit('1.2.3.4');
			// Advance but NOT past the window
			vi.advanceTimersByTime(WINDOW_MS - 1000);
			_runCleanup();

			expect(rateLimitStore.size).toBe(1);
		});

		it('only removes expired entries, leaving active ones intact', () => {
			vi.setSystemTime(0);
			checkRateLimit('old-ip');

			// Advance past the first window, then create a second entry
			vi.advanceTimersByTime(WINDOW_MS + 1);
			checkRateLimit('new-ip');

			_runCleanup();

			expect(rateLimitStore.has('old-ip')).toBe(false);
			expect(rateLimitStore.has('new-ip')).toBe(true);
		});
	});
});
