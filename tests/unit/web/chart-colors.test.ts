import { describe, expect, it } from 'vitest';

import {
	CHART_PALETTE_DARK,
	CHART_PALETTE_LIGHT,
	agentTypeLabel,
	getAgentColor,
} from '../../../web/src/lib/chart-colors.js';

describe('CHART_PALETTE_LIGHT and CHART_PALETTE_DARK', () => {
	it('both palettes have the same length', () => {
		expect(CHART_PALETTE_LIGHT.length).toBe(CHART_PALETTE_DARK.length);
	});

	it('all light palette entries are valid hex colors', () => {
		for (const color of CHART_PALETTE_LIGHT) {
			expect(color).toMatch(/^#[0-9a-f]{6}$/i);
		}
	});

	it('all dark palette entries are valid hex colors', () => {
		for (const color of CHART_PALETTE_DARK) {
			expect(color).toMatch(/^#[0-9a-f]{6}$/i);
		}
	});

	it('light and dark palettes are different (not accidentally the same)', () => {
		// At least one color should differ between the palettes
		const allSame = CHART_PALETTE_LIGHT.every((c, i) => c === CHART_PALETTE_DARK[i]);
		expect(allSame).toBe(false);
	});
});

describe('getAgentColor', () => {
	it('uses light palette by default', () => {
		expect(getAgentColor('planning')).toBe(CHART_PALETTE_LIGHT[0]);
	});

	it('uses provided palette when specified', () => {
		expect(getAgentColor('planning', CHART_PALETTE_DARK)).toBe(CHART_PALETTE_DARK[0]);
	});

	it('returns consistent color for known agent types', () => {
		const knownTypes = ['planning', 'implementation', 'review', 'splitting', 'debug'];
		for (const agentType of knownTypes) {
			const color = getAgentColor(agentType);
			expect(color).toMatch(/^#[0-9a-f]{6}$/i);
		}
	});

	it('returns consistent hash-based color for unknown types', () => {
		const colorA = getAgentColor('unknown-agent-type');
		const colorB = getAgentColor('unknown-agent-type');
		expect(colorA).toBe(colorB);
	});

	it('returns a palette color for unknown types', () => {
		const color = getAgentColor('some-custom-agent');
		expect(CHART_PALETTE_LIGHT).toContain(color);
	});
});

describe('agentTypeLabel', () => {
	it('converts kebab-case to Title Case', () => {
		expect(agentTypeLabel('respond-to-review')).toBe('Respond To Review');
		expect(agentTypeLabel('implementation')).toBe('Implementation');
	});
});
