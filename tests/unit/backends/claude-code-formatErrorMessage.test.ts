import { describe, expect, it } from 'vitest';

import { formatErrorMessage } from '../../../src/backends/claude-code/index.js';

describe('formatErrorMessage', () => {
	it('returns human-readable message for error_max_budget_usd', () => {
		const result = formatErrorMessage(
			{
				type: 'result',
				subtype: 'error_max_budget_usd',
				total_cost_usd: 0.7,
				num_turns: 5,
			} as never,
			0.18,
		);
		expect(result).toBe(
			'Budget limit reached: spent $0.70 of $0.18 allowed for this run. Increase the project work-item budget or retry with a higher limit.',
		);
	});

	it('uses "?" when total_cost_usd is undefined', () => {
		const result = formatErrorMessage(
			{
				type: 'result',
				subtype: 'error_max_budget_usd',
				num_turns: 1,
			} as never,
			1.0,
		);
		expect(result).toContain('spent $?');
		expect(result).toContain('of $1.00');
	});

	it('uses "?" when budgetUsd is undefined', () => {
		const result = formatErrorMessage(
			{
				type: 'result',
				subtype: 'error_max_budget_usd',
				total_cost_usd: 0.5,
				num_turns: 1,
			} as never,
			undefined,
		);
		expect(result).toContain('spent $0.50');
		expect(result).toContain('of $?');
	});

	it('returns joined errors for other error subtypes', () => {
		const result = formatErrorMessage(
			{
				type: 'result',
				subtype: 'error_max_turns',
				errors: ['Exceeded maximum turns', 'Too many iterations'],
				total_cost_usd: 1.5,
				num_turns: 20,
			} as never,
			5,
		);
		expect(result).toBe('Exceeded maximum turns; Too many iterations');
	});

	it('falls back to subtype when errors array is missing', () => {
		const result = formatErrorMessage(
			{
				type: 'result',
				subtype: 'error_max_turns',
				total_cost_usd: 1.0,
				num_turns: 10,
			} as never,
			5,
		);
		expect(result).toBe('error_max_turns');
	});
});
