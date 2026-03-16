import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('clsx', () => ({ clsx: (...args: unknown[]) => args.join(' ') }));
vi.mock('tailwind-merge', () => ({ twMerge: (s: string) => s }));

import {
	formatCost,
	formatCostSummary,
	formatDuration,
	formatRelativeTime,
} from '../../../web/src/lib/utils.js';

describe('formatDuration', () => {
	it('returns "-" for null', () => {
		expect(formatDuration(null)).toBe('-');
	});

	it('returns "-" for undefined', () => {
		expect(formatDuration(undefined)).toBe('-');
	});

	it('returns "0ms" for 0', () => {
		expect(formatDuration(0)).toBe('0ms');
	});

	it('returns milliseconds for values under 1000', () => {
		expect(formatDuration(500)).toBe('500ms');
	});

	it('returns seconds for values under 60s', () => {
		expect(formatDuration(1000)).toBe('1s');
		expect(formatDuration(45000)).toBe('45s');
		expect(formatDuration(59000)).toBe('59s');
	});

	it('returns minutes and seconds for values >= 60s', () => {
		expect(formatDuration(60000)).toBe('1m 0s');
		expect(formatDuration(90000)).toBe('1m 30s');
		expect(formatDuration(300000)).toBe('5m 0s');
	});
});

describe('formatCost', () => {
	it('returns "-" for null', () => {
		expect(formatCost(null)).toBe('-');
	});

	it('returns "-" for undefined', () => {
		expect(formatCost(undefined)).toBe('-');
	});

	it('formats number with 4 decimal places', () => {
		expect(formatCost(0.001)).toBe('$0.0010');
		expect(formatCost(1.23456)).toBe('$1.2346');
		expect(formatCost(0)).toBe('$0.0000');
	});

	it('handles string input', () => {
		expect(formatCost('0.5')).toBe('$0.5000');
		expect(formatCost('1.23456')).toBe('$1.2346');
	});

	it('returns "-" for NaN string input', () => {
		expect(formatCost('not-a-number')).toBe('-');
	});
});

describe('formatCostSummary', () => {
	it('returns "-" for null', () => {
		expect(formatCostSummary(null)).toBe('-');
	});

	it('returns "-" for undefined', () => {
		expect(formatCostSummary(undefined)).toBe('-');
	});

	it('formats number with 2 decimal places', () => {
		expect(formatCostSummary(0.001)).toBe('$0.00');
		expect(formatCostSummary(1.23456)).toBe('$1.23');
		expect(formatCostSummary(0)).toBe('$0.00');
		expect(formatCostSummary(5.5)).toBe('$5.50');
	});

	it('handles string input', () => {
		expect(formatCostSummary('0.5')).toBe('$0.50');
		expect(formatCostSummary('1.23456')).toBe('$1.23');
	});

	it('returns "-" for NaN string input', () => {
		expect(formatCostSummary('not-a-number')).toBe('-');
	});
});

describe('formatRelativeTime', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns "-" for null', () => {
		expect(formatRelativeTime(null)).toBe('-');
	});

	it('returns "-" for undefined', () => {
		expect(formatRelativeTime(undefined)).toBe('-');
	});

	it('returns "just now" for <60 seconds ago', () => {
		expect(formatRelativeTime(new Date('2025-06-15T11:59:30Z'))).toBe('just now');
	});

	it('returns minutes ago for <60 minutes', () => {
		expect(formatRelativeTime(new Date('2025-06-15T11:55:00Z'))).toBe('5m ago');
	});

	it('returns hours ago for <24 hours', () => {
		expect(formatRelativeTime(new Date('2025-06-15T10:00:00Z'))).toBe('2h ago');
	});

	it('returns days ago for <7 days', () => {
		expect(formatRelativeTime(new Date('2025-06-12T12:00:00Z'))).toBe('3d ago');
	});

	it('returns locale date string for 7+ days ago', () => {
		const result = formatRelativeTime(new Date('2025-06-01T12:00:00Z'));
		// Should be a date string, not a relative time
		expect(result).not.toContain('ago');
		expect(result).not.toBe('-');
	});

	it('handles string date input', () => {
		expect(formatRelativeTime('2025-06-15T11:55:00Z')).toBe('5m ago');
	});
});
