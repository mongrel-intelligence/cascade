import { describe, expect, it, vi } from 'vitest';

// Mock Recharts and UI dependencies (node environment, no DOM)
vi.mock('recharts', () => ({
	Bar: () => null,
	BarChart: () => null,
	CartesianGrid: () => null,
	Cell: () => null,
	Legend: () => null,
	ResponsiveContainer: () => null,
	Tooltip: () => null,
	XAxis: () => null,
	YAxis: () => null,
}));
vi.mock('@/components/ui/card.js', () => ({
	Card: () => null,
	CardContent: () => null,
	CardHeader: () => null,
	CardTitle: () => null,
}));
vi.mock('@/lib/chart-colors.js', () => ({
	agentTypeLabel: (t: string) => t,
	getAgentColor: () => '#000',
}));
vi.mock('@/lib/utils.js', () => ({ formatDuration: (ms: number) => `${ms}ms` }));

import { buildDurationChartData } from '../../../web/src/components/runs/project-work-duration-chart.js';

describe('buildDurationChartData', () => {
	it('sorts agent types by totalDurationMs descending', () => {
		const input = [
			{
				agentType: 'review',
				runCount: 2,
				totalCostUsd: '0.50',
				totalDurationMs: 30000,
				avgDurationMs: 15000,
			},
			{
				agentType: 'implementation',
				runCount: 5,
				totalCostUsd: '2.00',
				totalDurationMs: 120000,
				avgDurationMs: 24000,
			},
			{
				agentType: 'splitting',
				runCount: 1,
				totalCostUsd: '0.10',
				totalDurationMs: 5000,
				avgDurationMs: 5000,
			},
		];

		const result = buildDurationChartData(input);

		expect(result).toHaveLength(3);
		expect(result[0].agentType).toBe('implementation');
		expect(result[0].totalDurationMs).toBe(120000);
		expect(result[1].agentType).toBe('review');
		expect(result[1].totalDurationMs).toBe(30000);
		expect(result[2].agentType).toBe('splitting');
		expect(result[2].totalDurationMs).toBe(5000);
	});

	it('filters out agent types with zero duration', () => {
		const input = [
			{
				agentType: 'implementation',
				runCount: 3,
				totalCostUsd: '1.00',
				totalDurationMs: 60000,
				avgDurationMs: 20000,
			},
			{
				agentType: 'review',
				runCount: 0,
				totalCostUsd: '0.00',
				totalDurationMs: 0,
				avgDurationMs: null,
			},
			{
				agentType: 'splitting',
				runCount: 2,
				totalCostUsd: '0.20',
				totalDurationMs: 10000,
				avgDurationMs: 5000,
			},
		];

		const result = buildDurationChartData(input);

		expect(result).toHaveLength(2);
		expect(result.every((e) => e.totalDurationMs > 0)).toBe(true);
		expect(result.find((e) => e.agentType === 'review')).toBeUndefined();
	});

	it('returns stable ordering when durations are equal', () => {
		const input = [
			{
				agentType: 'type-a',
				runCount: 1,
				totalCostUsd: '0.50',
				totalDurationMs: 50000,
				avgDurationMs: 50000,
			},
			{
				agentType: 'type-b',
				runCount: 1,
				totalCostUsd: '0.50',
				totalDurationMs: 50000,
				avgDurationMs: 50000,
			},
		];

		const result = buildDurationChartData(input);

		// Both entries should be present
		expect(result).toHaveLength(2);
		// Both should have equal durations
		expect(result[0].totalDurationMs).toBe(result[1].totalDurationMs);
	});

	it('returns empty array when all durations are zero', () => {
		const input = [
			{
				agentType: 'implementation',
				runCount: 0,
				totalCostUsd: '0.00',
				totalDurationMs: 0,
				avgDurationMs: null,
			},
		];

		const result = buildDurationChartData(input);

		expect(result).toHaveLength(0);
	});

	it('uses null-safe avgDurationMs (null becomes 0)', () => {
		const input = [
			{
				agentType: 'planning',
				runCount: 1,
				totalCostUsd: '0.30',
				totalDurationMs: 15000,
				avgDurationMs: null,
			},
		];

		const result = buildDurationChartData(input);

		expect(result).toHaveLength(1);
		expect(result[0].avgDurationMs).toBe(0);
	});
});
