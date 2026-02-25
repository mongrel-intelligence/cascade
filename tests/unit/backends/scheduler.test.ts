import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	DEFAULT_SCHEDULE_MINUTES,
	ProgressScheduler,
} from '../../../src/backends/progressState/scheduler.js';

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('DEFAULT_SCHEDULE_MINUTES', () => {
	it('is [1, 3, 5]', () => {
		expect(DEFAULT_SCHEDULE_MINUTES).toEqual([1, 3, 5]);
	});
});

describe('ProgressScheduler', () => {
	describe('start / progressive schedule', () => {
		it('fires first tick at schedule[0] minutes', async () => {
			const tickFn = vi.fn().mockResolvedValue(undefined);
			const scheduler = new ProgressScheduler([1, 3, 5], 10);
			scheduler.start(tickFn);

			await vi.advanceTimersByTimeAsync(59_999);
			expect(tickFn).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(1);
			expect(tickFn).toHaveBeenCalledTimes(1);

			scheduler.stop();
		});

		it('fires second tick at schedule[1] minutes after first tick', async () => {
			const tickFn = vi.fn().mockResolvedValue(undefined);
			const scheduler = new ProgressScheduler([1, 3], 10);
			scheduler.start(tickFn);

			// First tick at 1min
			await vi.advanceTimersByTimeAsync(1 * 60 * 1000);
			expect(tickFn).toHaveBeenCalledTimes(1);

			// Second tick at 3 more minutes
			await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
			expect(tickFn).toHaveBeenCalledTimes(2);

			scheduler.stop();
		});

		it('falls back to intervalMinutes after schedule exhausted', async () => {
			const tickFn = vi.fn().mockResolvedValue(undefined);
			const scheduler = new ProgressScheduler([1], 5);
			scheduler.start(tickFn);

			// First tick (from schedule)
			await vi.advanceTimersByTimeAsync(1 * 60 * 1000);
			expect(tickFn).toHaveBeenCalledTimes(1);

			// Second tick (steady-state: 5min)
			await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
			expect(tickFn).toHaveBeenCalledTimes(2);

			// Third tick (steady-state: another 5min)
			await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
			expect(tickFn).toHaveBeenCalledTimes(3);

			scheduler.stop();
		});

		it('fires ticks at full progressive schedule then steady state', async () => {
			const tickFn = vi.fn().mockResolvedValue(undefined);
			const scheduler = new ProgressScheduler([1, 3, 5], 5);
			scheduler.start(tickFn);

			await vi.advanceTimersByTimeAsync(1 * 60 * 1000);
			expect(tickFn).toHaveBeenCalledTimes(1);

			await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
			expect(tickFn).toHaveBeenCalledTimes(2);

			await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
			expect(tickFn).toHaveBeenCalledTimes(3);

			await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
			expect(tickFn).toHaveBeenCalledTimes(4);

			scheduler.stop();
		});
	});

	describe('stop()', () => {
		it('prevents further ticks from firing', async () => {
			const tickFn = vi.fn().mockResolvedValue(undefined);
			const scheduler = new ProgressScheduler([1, 3], 10);
			scheduler.start(tickFn);

			// Fire first tick
			await vi.advanceTimersByTimeAsync(1 * 60 * 1000);
			expect(tickFn).toHaveBeenCalledTimes(1);

			// Stop the scheduler
			scheduler.stop();

			// Advance well past the next scheduled tick
			await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
			expect(tickFn).toHaveBeenCalledTimes(1);
		});

		it('is safe to call multiple times', () => {
			const tickFn = vi.fn().mockResolvedValue(undefined);
			const scheduler = new ProgressScheduler([1], 5);
			scheduler.start(tickFn);
			scheduler.stop();
			expect(() => scheduler.stop()).not.toThrow();
		});

		it('prevents next tick from scheduling even if stop called during tick', async () => {
			let resolveTickFn!: () => void;
			const tickPromise = new Promise<void>((resolve) => {
				resolveTickFn = resolve;
			});
			const tickFn = vi.fn().mockReturnValue(tickPromise);
			const scheduler = new ProgressScheduler([1], 5);
			scheduler.start(tickFn);

			// Trigger first tick — it will not resolve yet
			await vi.advanceTimersByTimeAsync(1 * 60 * 1000);
			expect(tickFn).toHaveBeenCalledTimes(1);

			// Stop while tick is "running"
			scheduler.stop();

			// Resolve the tick
			resolveTickFn();
			await vi.advanceTimersByTimeAsync(0);

			// No further tick should be scheduled
			await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
			expect(tickFn).toHaveBeenCalledTimes(1);
		});
	});

	describe('edge cases', () => {
		it('handles empty schedule by immediately using intervalMinutes', async () => {
			const tickFn = vi.fn().mockResolvedValue(undefined);
			const scheduler = new ProgressScheduler([], 3);
			scheduler.start(tickFn);

			await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
			expect(tickFn).toHaveBeenCalledTimes(1);

			scheduler.stop();
		});
	});
});
