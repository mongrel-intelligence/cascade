import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stub out the module dependencies that the stats page imports
vi.mock('@/components/projects/stats-filters.js', () => ({ StatsFiltersBar: () => null }));
vi.mock('@/components/projects/stats-summary.js', () => ({ StatsSummary: () => null }));
vi.mock('@/components/runs/project-work-duration-chart.js', () => ({
	ProjectWorkDurationChart: () => null,
}));
vi.mock('@/components/runs/work-item-cost-chart.js', () => ({ WorkItemCostChart: () => null }));
vi.mock('@/lib/trpc.js', () => ({ trpc: {} }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({}) }));
vi.mock('@tanstack/react-router', () => ({ createRoute: () => ({}) }));
vi.mock('react', () => ({
	default: {},
	useState: () => [{}, () => undefined],
	useMemo: (fn: () => unknown) => fn(),
}));
vi.mock('../../../web/src/routes/projects/$projectId.js', () => ({ projectDetailRoute: {} }));

import { computeDateFrom } from '../../../web/src/routes/projects/$projectId.stats.js';

describe('computeDateFrom', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		// Fix time to 2025-06-15T15:30:45.123Z (mid-day, not midnight)
		vi.setSystemTime(new Date('2025-06-15T15:30:45.123Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns undefined for "all"', () => {
		expect(computeDateFrom('all')).toBeUndefined();
	});

	it('returns undefined for invalid (non-numeric) input', () => {
		expect(computeDateFrom('abc')).toBeUndefined();
	});

	it('returns a day-truncated ISO string for "30"', () => {
		const result = computeDateFrom('30');
		expect(result).toBeDefined();
		// Should end with T00:00:00.000Z (midnight UTC)
		expect(result).toMatch(/T00:00:00\.000Z$/);
	});

	it('returns a day-truncated ISO string for "7"', () => {
		const result = computeDateFrom('7');
		expect(result).toBeDefined();
		expect(result).toMatch(/T00:00:00\.000Z$/);
	});

	it('returns a day-truncated ISO string for "90"', () => {
		const result = computeDateFrom('90');
		expect(result).toBeDefined();
		expect(result).toMatch(/T00:00:00\.000Z$/);
	});

	it('returns the correct date for "30" (30 days before fixed time)', () => {
		// 2025-06-15 minus 30 days = 2025-05-16
		const result = computeDateFrom('30');
		expect(result).toBe('2025-05-16T00:00:00.000Z');
	});

	it('returns the correct date for "7" (7 days before fixed time)', () => {
		// 2025-06-15 minus 7 days = 2025-06-08
		const result = computeDateFrom('7');
		expect(result).toBe('2025-06-08T00:00:00.000Z');
	});

	it('two calls within the same day return the same value', () => {
		const result1 = computeDateFrom('30');
		const result2 = computeDateFrom('30');
		expect(result1).toBe(result2);
	});

	it('returns the same value regardless of sub-day time variation', () => {
		// Simulate two renders at different milliseconds within the same day
		vi.setSystemTime(new Date('2025-06-15T08:00:00.001Z'));
		const result1 = computeDateFrom('30');

		vi.setSystemTime(new Date('2025-06-15T23:59:59.999Z'));
		const result2 = computeDateFrom('30');

		expect(result1).toBe(result2);
	});
});
