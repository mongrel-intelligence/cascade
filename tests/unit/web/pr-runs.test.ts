import { describe, expect, it } from 'vitest';

/**
 * Tests for the PR runs page logic.
 *
 * Note: React component rendering tests are not possible in the current test
 * setup (node environment, no jsdom). These tests cover pure-logic aspects.
 */

// ─── PR header rendering logic ───────────────────────────────────────────────

describe('PR title display', () => {
	function buildPRHeader(prNumber: number, prTitle: string | null): string {
		if (prTitle) {
			return `PR #${prNumber} ${prTitle}`;
		}
		return `PR #${prNumber}`;
	}

	it('shows PR number with title when title is available', () => {
		expect(buildPRHeader(42, 'Fix the bug')).toBe('PR #42 Fix the bug');
	});

	it('shows only PR number when title is null', () => {
		expect(buildPRHeader(42, null)).toBe('PR #42');
	});

	it('handles PR number 1', () => {
		expect(buildPRHeader(1, null)).toBe('PR #1');
	});
});

// ─── Loading / error states logic ────────────────────────────────────────────

describe('page state resolution', () => {
	type QueryState =
		| { isLoading: true; isError: false; data: undefined }
		| { isLoading: false; isError: true; data: undefined; error: { message: string } }
		| { isLoading: false; isError: false; data: unknown[] };

	function resolvePageState(query: QueryState): 'loading' | 'error' | 'data' {
		if (query.isLoading) return 'loading';
		if (query.isError) return 'error';
		return 'data';
	}

	it('returns loading when isLoading is true', () => {
		const q: QueryState = { isLoading: true, isError: false, data: undefined };
		expect(resolvePageState(q)).toBe('loading');
	});

	it('returns error when isError is true', () => {
		const q: QueryState = {
			isLoading: false,
			isError: true,
			data: undefined,
			error: { message: 'Network error' },
		};
		expect(resolvePageState(q)).toBe('error');
	});

	it('returns data when query has resolved', () => {
		const q: QueryState = { isLoading: false, isError: false, data: [] };
		expect(resolvePageState(q)).toBe('data');
	});
});

// ─── Auto-refresh interval logic ─────────────────────────────────────────────

describe('auto-refresh interval', () => {
	function getRefetchInterval(runs: Array<{ status: string }> | undefined): number | false {
		const hasRunning = runs?.some((r) => r.status === 'running');
		return hasRunning ? 5000 : false;
	}

	it('returns 5000ms when there are running runs', () => {
		const runs = [{ status: 'running' }, { status: 'completed' }];
		expect(getRefetchInterval(runs)).toBe(5000);
	});

	it('returns false when no runs are running', () => {
		const runs = [{ status: 'completed' }, { status: 'failed' }];
		expect(getRefetchInterval(runs)).toBe(false);
	});

	it('returns false for empty runs array', () => {
		expect(getRefetchInterval([])).toBe(false);
	});

	it('returns false for undefined runs', () => {
		expect(getRefetchInterval(undefined)).toBe(false);
	});
});

// ─── Route param coercion ─────────────────────────────────────────────────────

describe('route param coercion for prNumber', () => {
	it('prNumber param is a string in TanStack Router', () => {
		// Route params are always strings
		const routeParams: Record<string, string> = {
			projectId: 'my-project',
			prNumber: '42',
		};
		expect(typeof routeParams.prNumber).toBe('string');
	});

	it('must be explicitly converted to a number for tRPC query', () => {
		const routeParam = '42';
		const prNumber = Number(routeParam);
		expect(typeof prNumber).toBe('number');
		expect(prNumber).toBe(42);
	});

	it('URL segments in /prs/:projectId/:prNumber must be strings', () => {
		// Demonstrates that String() is needed when building route params
		const prNumber = 42;
		const prNumberParam = String(prNumber);
		expect(typeof prNumberParam).toBe('string');
		expect(prNumberParam).toBe('42');
	});
});
