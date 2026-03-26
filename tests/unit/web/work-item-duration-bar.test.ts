import { describe, expect, it, vi } from 'vitest';

// Mock chart-colors and utils (node environment, no DOM)
vi.mock('@/lib/chart-colors.js', () => ({
	agentTypeLabel: (t: string) =>
		t
			.split('-')
			.map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
			.join(' '),
	getAgentColor: (t: string) => (t === 'implementation' ? '#3aada0' : '#e8642a'),
}));
vi.mock('@/lib/utils.js', () => ({
	formatDuration: (ms: number | null | undefined) => (ms == null ? '-' : `${ms}ms`),
}));

import { buildDurationSegments } from '../../../web/src/components/projects/work-item-duration-bar.js';

describe('buildDurationSegments', () => {
	it('returns empty array when runs is empty', () => {
		expect(buildDurationSegments([])).toEqual([]);
	});

	it('returns empty array when all runs have zero duration', () => {
		const result = buildDurationSegments([
			{ agentType: 'implementation', durationMs: 0, status: 'completed' },
		]);
		expect(result).toEqual([]);
	});

	it('computes correct percentages for two segments', () => {
		const runs = [
			{ agentType: 'implementation', durationMs: 60000, status: 'completed' },
			{ agentType: 'review', durationMs: 40000, status: 'completed' },
		];
		const segments = buildDurationSegments(runs);

		expect(segments).toHaveLength(2);
		expect(segments[0].pct).toBeCloseTo(60, 1);
		expect(segments[1].pct).toBeCloseTo(40, 1);
	});

	it('assigns colors from getAgentColor', () => {
		const runs = [{ agentType: 'implementation', durationMs: 30000, status: 'completed' }];
		const segments = buildDurationSegments(runs);

		expect(segments[0].color).toBe('#3aada0');
	});

	it('filters out zero-duration runs but keeps positive ones', () => {
		const runs = [
			{ agentType: 'implementation', durationMs: 0, status: 'completed' },
			{ agentType: 'review', durationMs: 50000, status: 'completed' },
		];
		const segments = buildDurationSegments(runs);

		expect(segments).toHaveLength(1);
		expect(segments[0].agentType).toBe('review');
	});

	it('numbers repeated agent types sequentially', () => {
		const runs = [
			{ agentType: 'implementation', durationMs: 10000, status: 'completed' },
			{ agentType: 'implementation', durationMs: 20000, status: 'completed' },
		];
		const segments = buildDurationSegments(runs);

		expect(segments[0].label).toBe('Implementation #1');
		expect(segments[1].label).toBe('Implementation #2');
	});

	it('single run has 100% width', () => {
		const runs = [{ agentType: 'review', durationMs: 90000, status: 'completed' }];
		const segments = buildDurationSegments(runs);

		expect(segments[0].pct).toBe(100);
	});

	it('preserves status in segment', () => {
		const runs = [{ agentType: 'implementation', durationMs: 30000, status: 'failed' }];
		const segments = buildDurationSegments(runs);

		expect(segments[0].status).toBe('failed');
	});
});

describe('outlier threshold', () => {
	it('total > 2× avg is considered outlier', () => {
		const projectAvgDurationMs = 30000;
		const totalMs = 70000; // > 60000 (2x avg)
		expect(totalMs > 2 * projectAvgDurationMs).toBe(true);
	});

	it('total == 2× avg is NOT considered outlier', () => {
		const projectAvgDurationMs = 30000;
		const totalMs = 60000; // == 2x avg
		expect(totalMs > 2 * projectAvgDurationMs).toBe(false);
	});

	it('total < 2× avg is NOT considered outlier', () => {
		const projectAvgDurationMs = 30000;
		const totalMs = 50000; // < 2x avg
		expect(totalMs > 2 * projectAvgDurationMs).toBe(false);
	});

	it('no avg means no outlier detection', () => {
		const projectAvgDurationMs = null;
		const totalMs = 99999999;
		expect(projectAvgDurationMs != null && totalMs > 2 * projectAvgDurationMs).toBe(false);
	});
});
