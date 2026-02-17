// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useElapsedTime } from '../../../web/src/lib/useElapsedTime.js';

describe('useElapsedTime', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns null when isRunning is false', () => {
		vi.setSystemTime(new Date('2025-01-01T00:00:05.000Z'));

		const { result } = renderHook(() => useElapsedTime('2025-01-01T00:00:00.000Z', false));

		expect(result.current).toBeNull();
	});

	it('returns null when startedAt is null', () => {
		vi.setSystemTime(new Date('2025-01-01T00:00:05.000Z'));

		const { result } = renderHook(() => useElapsedTime(null, true));

		expect(result.current).toBeNull();
	});

	it('returns null when both startedAt is null and isRunning is false', () => {
		const { result } = renderHook(() => useElapsedTime(null, false));

		expect(result.current).toBeNull();
	});

	it('returns elapsed ms when running with a startedAt', () => {
		vi.setSystemTime(new Date('2025-01-01T00:00:05.000Z'));

		const { result } = renderHook(() => useElapsedTime('2025-01-01T00:00:00.000Z', true));

		expect(result.current).toBe(5000);
	});

	it('returns 0 elapsed when startedAt equals current time', () => {
		vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

		const { result } = renderHook(() => useElapsedTime('2025-01-01T00:00:00.000Z', true));

		expect(result.current).toBe(0);
	});

	it('updates elapsed every second via setInterval', () => {
		vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

		const { result } = renderHook(() => useElapsedTime('2025-01-01T00:00:00.000Z', true));

		expect(result.current).toBe(0);

		act(() => vi.advanceTimersByTime(1000));
		expect(result.current).toBe(1000);

		act(() => vi.advanceTimersByTime(1000));
		expect(result.current).toBe(2000);

		act(() => vi.advanceTimersByTime(3000));
		expect(result.current).toBe(5000);
	});

	it('cleans up interval on unmount (no state update after unmount)', () => {
		vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

		const { result, unmount } = renderHook(() => useElapsedTime('2025-01-01T00:00:00.000Z', true));

		act(() => vi.advanceTimersByTime(2000));
		expect(result.current).toBe(2000);

		unmount();

		// After unmount, advancing timers should not cause errors
		// (interval should have been cleared)
		act(() => vi.advanceTimersByTime(3000));
	});

	it('resets to null when isRunning transitions from true to false', () => {
		vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

		const { result, rerender } = renderHook(
			({ startedAt, isRunning }) => useElapsedTime(startedAt, isRunning),
			{ initialProps: { startedAt: '2025-01-01T00:00:00.000Z', isRunning: true } },
		);

		act(() => vi.advanceTimersByTime(2000));
		expect(result.current).toBe(2000);

		// Transition to not running (e.g., run completed)
		rerender({ startedAt: '2025-01-01T00:00:00.000Z', isRunning: false });

		expect(result.current).toBeNull();
	});

	it('stops ticking after isRunning becomes false', () => {
		vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

		const { result, rerender } = renderHook(
			({ startedAt, isRunning }) => useElapsedTime(startedAt, isRunning),
			{ initialProps: { startedAt: '2025-01-01T00:00:00.000Z', isRunning: true } },
		);

		act(() => vi.advanceTimersByTime(2000));
		expect(result.current).toBe(2000);

		rerender({ startedAt: '2025-01-01T00:00:00.000Z', isRunning: false });
		expect(result.current).toBeNull();

		// Advancing timers should not change the result
		act(() => vi.advanceTimersByTime(5000));
		expect(result.current).toBeNull();
	});

	it('handles large elapsed durations correctly', () => {
		vi.setSystemTime(new Date('2025-01-01T00:01:30.000Z'));

		const { result } = renderHook(() => useElapsedTime('2025-01-01T00:00:00.000Z', true));

		// 90 seconds elapsed
		expect(result.current).toBe(90000);
	});
});
