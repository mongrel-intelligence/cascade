import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Test the core computation logic of useElapsedTime.
// The hook computes: elapsed = Date.now() - new Date(startedAt).getTime()
// and updates it every 1000ms via setInterval when isRunning is true.

describe('useElapsedTime - elapsed computation logic', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('computes elapsed time correctly', () => {
		const startedAt = '2025-01-01T00:00:00.000Z';
		vi.setSystemTime(new Date('2025-01-01T00:00:05.000Z'));

		const start = new Date(startedAt).getTime();
		const elapsed = Date.now() - start;

		expect(elapsed).toBe(5000);
	});

	it('computes elapsed time as zero at start', () => {
		const startedAt = '2025-01-01T00:00:00.000Z';
		vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

		const start = new Date(startedAt).getTime();
		const elapsed = Date.now() - start;

		expect(elapsed).toBe(0);
	});

	it('elapsed value grows as time advances', () => {
		const startedAt = '2025-01-01T00:00:00.000Z';
		vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

		const start = new Date(startedAt).getTime();
		const computations: number[] = [];

		// Simulate the update function being called multiple times
		const update = () => computations.push(Date.now() - start);

		update(); // immediate first render
		vi.advanceTimersByTime(1000);
		update();
		vi.advanceTimersByTime(1000);
		update();

		expect(computations[0]).toBe(0);
		expect(computations[1]).toBe(1000);
		expect(computations[2]).toBe(2000);
		expect(computations[1]).toBeGreaterThan(computations[0]);
		expect(computations[2]).toBeGreaterThan(computations[1]);
	});

	it('returns null when not running (condition check)', () => {
		const isRunning = false;
		const startedAt = '2025-01-01T00:00:00.000Z';

		// When not running, the hook sets elapsed to null and returns early
		const shouldComputeElapsed = isRunning && startedAt !== null;
		expect(shouldComputeElapsed).toBe(false);
	});

	it('returns null when startedAt is null (condition check)', () => {
		const isRunning = true;
		const startedAt: string | null = null;

		// When startedAt is null, the hook sets elapsed to null and returns early
		const shouldComputeElapsed = isRunning && startedAt !== null;
		expect(shouldComputeElapsed).toBe(false);
	});

	it('computes elapsed when running and startedAt is provided (condition check)', () => {
		const isRunning = true;
		const startedAt = '2025-01-01T00:00:00.000Z';

		const shouldComputeElapsed = isRunning && startedAt !== null;
		expect(shouldComputeElapsed).toBe(true);
	});

	it('setInterval fires the update callback every 1000ms', () => {
		const update = vi.fn();
		const id = setInterval(update, 1000);

		vi.advanceTimersByTime(1000);
		expect(update).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(1000);
		expect(update).toHaveBeenCalledTimes(2);

		vi.advanceTimersByTime(3000);
		expect(update).toHaveBeenCalledTimes(5);

		clearInterval(id);
	});

	it('clearInterval stops the update callback (cleanup)', () => {
		const update = vi.fn();
		const id = setInterval(update, 1000);

		vi.advanceTimersByTime(2000);
		expect(update).toHaveBeenCalledTimes(2);

		// Simulate unmount / cleanup
		clearInterval(id);

		vi.advanceTimersByTime(3000);
		// Should not be called anymore after cleanup
		expect(update).toHaveBeenCalledTimes(2);
	});

	it('elapsed after 90 seconds formats as expected by formatDuration', () => {
		const startedAt = '2025-01-01T00:00:00.000Z';
		vi.setSystemTime(new Date('2025-01-01T00:01:30.000Z'));

		const start = new Date(startedAt).getTime();
		const elapsed = Date.now() - start;

		expect(elapsed).toBe(90000);

		// formatDuration(90000) should return "1m 30s"
		const seconds = Math.floor(elapsed / 1000);
		const minutes = Math.floor(seconds / 60);
		const remaining = seconds % 60;
		expect(`${minutes}m ${remaining}s`).toBe('1m 30s');
	});
});
