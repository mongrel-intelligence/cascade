import { describe, expect, it } from 'vitest';
import {
	appendFrictionGuidance,
	FRICTION_REPORTING_GUIDANCE,
	shouldAppendFrictionGuidance,
} from '../../../../src/agents/shared/frictionGuidance.js';

describe('friction reporting guidance', () => {
	it('is gated on pm:friction capability availability', () => {
		expect(shouldAppendFrictionGuidance(['pm:friction'])).toBe(true);
		expect(shouldAppendFrictionGuidance(['pm:write'])).toBe(false);
	});

	it('appends central guidance only when ReportFriction is available', () => {
		expect(appendFrictionGuidance('Base prompt', ['pm:write'])).toBe('Base prompt');
		expect(appendFrictionGuidance('Base prompt', ['pm:friction'])).toContain(
			FRICTION_REPORTING_GUIDANCE,
		);
	});

	it('limits reports to incidental papercuts and tells agents to keep working unless blocked', () => {
		expect(FRICTION_REPORTING_GUIDANCE).toContain('incidental papercuts');
		expect(FRICTION_REPORTING_GUIDANCE).toContain('Do not report core task difficulty');
		expect(FRICTION_REPORTING_GUIDANCE).toContain('Keep working after reporting friction unless');
	});
});
