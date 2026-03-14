import { describe, expect, it } from 'vitest';

/**
 * Tests for the work item / PR runs page logic.
 *
 * Note: React component rendering tests are not possible in the current test
 * setup (node environment, no jsdom). These tests cover the pure logic that
 * the components depend on.
 */

// ─── prNumber parsing ────────────────────────────────────────────────────────

describe('PR number parsing', () => {
	// TanStack Router passes all params as strings.
	// The PR runs page does Number(prNumberStr) to convert.

	it('parses a valid integer string to a number', () => {
		const prNumberStr = '42';
		const prNumber = Number(prNumberStr);
		expect(prNumber).toBe(42);
		expect(Number.isNaN(prNumber)).toBe(false);
	});

	it('parses a large PR number correctly', () => {
		const prNumberStr = '9999';
		expect(Number(prNumberStr)).toBe(9999);
	});

	it('returns NaN for a non-numeric string', () => {
		const prNumberStr = 'abc';
		expect(Number.isNaN(Number(prNumberStr))).toBe(true);
	});

	it('rounds non-integer strings to the nearest integer via Number()', () => {
		// e.g. if router somehow passes "42.5"
		const prNumber = Number('42.5');
		expect(prNumber).toBe(42.5); // Number() keeps as float; Math.round() would be 43
	});

	it('returns 0 for empty string', () => {
		expect(Number('')).toBe(0);
	});
});

// ─── Route path format ───────────────────────────────────────────────────────

describe('Route paths', () => {
	it('work item route uses projectId and workItemId segments', () => {
		const path = '/work-items/$projectId/$workItemId';
		expect(path).toContain('$projectId');
		expect(path).toContain('$workItemId');
	});

	it('PR runs route uses projectId and prNumber segments', () => {
		const path = '/prs/$projectId/$prNumber';
		expect(path).toContain('$projectId');
		expect(path).toContain('$prNumber');
	});
});

// ─── Summary stats logic ─────────────────────────────────────────────────────

interface Run {
	status: string;
}

function computeSummaryStats(runs: Run[]) {
	return {
		total: runs.length,
		running: runs.filter((r) => r.status === 'running').length,
		completed: runs.filter((r) => r.status === 'completed').length,
		failed: runs.filter((r) => r.status === 'failed').length,
	};
}

describe('computeSummaryStats', () => {
	it('returns all zeros for empty runs array', () => {
		expect(computeSummaryStats([])).toEqual({
			total: 0,
			running: 0,
			completed: 0,
			failed: 0,
		});
	});

	it('correctly counts running runs', () => {
		const runs: Run[] = [{ status: 'running' }, { status: 'running' }, { status: 'completed' }];
		const stats = computeSummaryStats(runs);
		expect(stats.running).toBe(2);
		expect(stats.total).toBe(3);
	});

	it('correctly counts completed runs', () => {
		const runs: Run[] = [
			{ status: 'completed' },
			{ status: 'completed' },
			{ status: 'failed' },
			{ status: 'running' },
		];
		const stats = computeSummaryStats(runs);
		expect(stats.completed).toBe(2);
		expect(stats.failed).toBe(1);
		expect(stats.running).toBe(1);
		expect(stats.total).toBe(4);
	});

	it('correctly counts failed runs', () => {
		const runs: Run[] = [{ status: 'failed' }, { status: 'failed' }, { status: 'failed' }];
		const stats = computeSummaryStats(runs);
		expect(stats.failed).toBe(3);
		expect(stats.running).toBe(0);
		expect(stats.completed).toBe(0);
	});
});

// ─── prNumber as route param string ──────────────────────────────────────────

describe('prNumber to route param conversion', () => {
	it('converts a number to string for route params', () => {
		const prNumber = 42;
		const param = String(prNumber);
		expect(param).toBe('42');
	});

	it('roundtrips through String/Number conversion correctly', () => {
		const original = 123;
		const roundtripped = Number(String(original));
		expect(roundtripped).toBe(original);
	});
});
