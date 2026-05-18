import { describe, expect, it } from 'vitest';
import { getStatsAgentTypeOptions } from '../../../web/src/components/projects/stats-filters.js';

describe('getStatsAgentTypeOptions', () => {
	it('uses dynamically supplied custom agent types', () => {
		expect(getStatsAgentTypeOptions(['prd', 'plan-implement'])).toEqual(['prd', 'plan-implement']);
	});

	it('falls back to built-in agent types when dynamic data is unavailable', () => {
		const options = getStatsAgentTypeOptions();

		expect(options).toContain('implementation');
		expect(options).toContain('planning');
	});

	it('keeps the selected custom value even if it is not in the loaded options', () => {
		expect(getStatsAgentTypeOptions(['implementation'], 'prd')).toEqual(['implementation', 'prd']);
	});
});
