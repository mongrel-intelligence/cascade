import { describe, expect, it } from 'vitest';
import { skip } from '../../../../src/triggers/shared/skip.js';

describe('skip()', () => {
	it('builds a TriggerResult with structured skipReason', () => {
		const result = skip('check-suite-failure', 'PR not authored by a cascade persona');
		expect(result).toEqual({
			agentType: null,
			agentInput: {},
			skipReason: {
				handler: 'check-suite-failure',
				message: 'PR not authored by a cascade persona',
			},
		});
	});

	it('always sets agentType to null (so webhook-processor takes the skip branch)', () => {
		const result = skip('pr-conflict-detected', 'reason');
		expect(result.agentType).toBeNull();
	});
});
