import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('chalk', () => ({
	default: {
		bold: (s: string) => s,
		blue: (s: string) => s,
		green: (s: string) => s,
		red: (s: string) => s,
		yellow: (s: string) => s,
		dim: (s: string) => s,
	},
}));

import {
	formatBoolean,
	formatCost,
	formatDate,
	formatDuration,
	formatStatus,
	printDetail,
	printTable,
} from '../../../../src/cli/dashboard/_shared/format.js';

describe('formatDate', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-02-16T12:00:00Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns dash for falsy input', () => {
		expect(formatDate(null)).toBe('—');
		expect(formatDate(undefined)).toBe('—');
		expect(formatDate('')).toBe('—');
	});

	it('returns "just now" for <60 seconds ago', () => {
		expect(formatDate('2026-02-16T11:59:30Z')).toBe('just now');
	});

	it('returns minutes for <1 hour ago', () => {
		expect(formatDate('2026-02-16T11:30:00Z')).toBe('30m ago');
	});

	it('returns hours for <1 day ago', () => {
		expect(formatDate('2026-02-16T06:00:00Z')).toBe('6h ago');
	});

	it('returns days for <1 week ago', () => {
		expect(formatDate('2026-02-14T12:00:00Z')).toBe('2d ago');
	});

	it('returns ISO date for >1 week ago', () => {
		expect(formatDate('2026-01-01T00:00:00Z')).toBe('2026-01-01');
	});
});

describe('formatDuration', () => {
	it('returns dash for null/undefined', () => {
		expect(formatDuration(null)).toBe('—');
		expect(formatDuration(undefined)).toBe('—');
	});

	it('formats milliseconds', () => {
		expect(formatDuration(500)).toBe('500ms');
	});

	it('formats seconds', () => {
		expect(formatDuration(5000)).toBe('5s');
		expect(formatDuration(45000)).toBe('45s');
	});

	it('formats minutes and seconds', () => {
		expect(formatDuration(83000)).toBe('1m 23s');
		expect(formatDuration(600000)).toBe('10m 0s');
	});
});

describe('formatCost', () => {
	it('returns dash for null/undefined', () => {
		expect(formatCost(null)).toBe('—');
		expect(formatCost(undefined)).toBe('—');
	});

	it('formats as USD with 2 decimals', () => {
		expect(formatCost(0.42)).toBe('$0.42');
		expect(formatCost(1)).toBe('$1.00');
		expect(formatCost(0)).toBe('$0.00');
	});

	it('handles string numbers', () => {
		expect(formatCost('3.14')).toBe('$3.14');
	});
});

describe('formatStatus', () => {
	it('returns colored status for known statuses', () => {
		expect(formatStatus('running')).toBe('running');
		expect(formatStatus('success')).toBe('success');
		expect(formatStatus('failed')).toBe('failed');
		expect(formatStatus('cancelled')).toBe('cancelled');
	});

	it('returns raw string for unknown status', () => {
		expect(formatStatus('pending')).toBe('pending');
	});

	it('handles null/undefined', () => {
		expect(formatStatus(null)).toBe('');
		expect(formatStatus(undefined)).toBe('');
	});
});

describe('formatBoolean', () => {
	it('returns yes for truthy', () => {
		expect(formatBoolean(true)).toBe('yes');
		expect(formatBoolean(1)).toBe('yes');
	});

	it('returns no for falsy', () => {
		expect(formatBoolean(false)).toBe('no');
		expect(formatBoolean(0)).toBe('no');
		expect(formatBoolean(null)).toBe('no');
	});
});

describe('printTable', () => {
	let consoleSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		consoleSpy.mockRestore();
	});

	it('prints "(no results)" for empty rows', () => {
		printTable([], [{ key: 'id', header: 'ID' }]);

		expect(consoleSpy).toHaveBeenCalledWith('  (no results)');
	});

	it('prints header and rows', () => {
		printTable(
			[
				{ id: 1, name: 'Alice' },
				{ id: 2, name: 'Bob' },
			],
			[
				{ key: 'id', header: 'ID' },
				{ key: 'name', header: 'Name' },
			],
		);

		// Header line + separator + 2 data rows = 4 calls
		expect(consoleSpy).toHaveBeenCalledTimes(4);
		// First call is the bold header
		const headerLine = consoleSpy.mock.calls[0][0];
		expect(headerLine).toContain('ID');
		expect(headerLine).toContain('Name');
	});

	it('applies format function to values', () => {
		printTable(
			[{ cost: 1.5 }],
			[{ key: 'cost', header: 'Cost', format: (v) => `$${Number(v).toFixed(2)}` }],
		);

		// Header + separator + 1 row
		expect(consoleSpy).toHaveBeenCalledTimes(3);
		const dataLine = consoleSpy.mock.calls[2][0];
		expect(dataLine).toContain('$1.50');
	});

	it('handles undefined values gracefully', () => {
		printTable(
			[{ id: 1 }],
			[
				{ key: 'id', header: 'ID' },
				{ key: 'missing', header: 'Missing' },
			],
		);

		expect(consoleSpy).toHaveBeenCalledTimes(3);
	});
});

describe('printDetail', () => {
	let consoleSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		consoleSpy.mockRestore();
	});

	it('prints key-value pairs', () => {
		printDetail(
			{ name: 'Alice', role: 'admin' },
			{
				name: { label: 'Name' },
				role: { label: 'Role' },
			},
		);

		expect(consoleSpy).toHaveBeenCalledTimes(2);
		expect(consoleSpy.mock.calls[0][0]).toContain('Name');
		expect(consoleSpy.mock.calls[0][0]).toContain('Alice');
		expect(consoleSpy.mock.calls[1][0]).toContain('Role');
		expect(consoleSpy.mock.calls[1][0]).toContain('admin');
	});

	it('shows dash for missing values', () => {
		printDetail({ name: undefined }, { name: { label: 'Name' } });

		expect(consoleSpy.mock.calls[0][0]).toContain('—');
	});

	it('applies format function', () => {
		printDetail(
			{ active: true },
			{ active: { label: 'Active', format: (v) => (v ? 'YES' : 'NO') } },
		);

		expect(consoleSpy.mock.calls[0][0]).toContain('YES');
	});
});
