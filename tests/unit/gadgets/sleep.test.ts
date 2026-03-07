import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sleep } from '../../../src/gadgets/Sleep.js';

let gadget: Sleep;

beforeEach(() => {
	gadget = new Sleep();
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe('Sleep', () => {
	describe('return value', () => {
		it('returns "Slept for 1 second" (singular) when seconds is 1', async () => {
			const promise = gadget.execute({ comment: 'waiting', seconds: 1 });
			vi.runAllTimersAsync();
			const result = await promise;
			expect(result).toBe('Slept for 1 second');
		});

		it('returns "Slept for 5 seconds" (plural) when seconds is 5', async () => {
			const promise = gadget.execute({ comment: 'waiting', seconds: 5 });
			vi.runAllTimersAsync();
			const result = await promise;
			expect(result).toBe('Slept for 5 seconds');
		});

		it('returns "Slept for 0.5 seconds" (plural) for fractional seconds', async () => {
			const promise = gadget.execute({ comment: 'short wait', seconds: 0.5 });
			vi.runAllTimersAsync();
			const result = await promise;
			expect(result).toBe('Slept for 0.5 seconds');
		});

		it('returns "Slept for 10 seconds" (plural) for larger values', async () => {
			const promise = gadget.execute({ comment: 'longer wait', seconds: 10 });
			vi.runAllTimersAsync();
			const result = await promise;
			expect(result).toBe('Slept for 10 seconds');
		});
	});

	describe('timing', () => {
		it('waits for the specified duration before resolving', async () => {
			const seconds = 3;
			let resolved = false;

			const promise = gadget.execute({ comment: 'timing test', seconds }).then((r) => {
				resolved = true;
				return r;
			});

			// Should not have resolved yet
			expect(resolved).toBe(false);

			// Advance time to just before the sleep ends
			vi.advanceTimersByTime(seconds * 1000 - 1);
			await Promise.resolve();
			expect(resolved).toBe(false);

			// Advance past the sleep duration
			vi.advanceTimersByTime(2);
			await promise;
			expect(resolved).toBe(true);
		});
	});
});
