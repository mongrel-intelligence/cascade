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

	it('uses an action-trigger framing that calibrates toward over-reporting', () => {
		// Section heading the agent will see in its system prompt.
		expect(FRICTION_REPORTING_GUIDANCE).toContain('## Friction Reporting');

		// Direct imperative — the rewrite (2026-05-10) replaced the prior
		// "use it only for incidental papercuts in the environment, tooling,
		// repository setup, documentation, or developer workflow" framing
		// because that scoping read as a constraint, not a trigger. The new
		// framing is "when X happens, do Y" with explicit "when in doubt,
		// report" calibration.
		expect(FRICTION_REPORTING_GUIDANCE).toContain(
			'makes your work harder than it strictly needs to be',
		);
		expect(FRICTION_REPORTING_GUIDANCE).toContain('When in doubt, report');
		expect(FRICTION_REPORTING_GUIDANCE).toContain('Better to over-report');

		// Non-blocking semantic preserved — friction stays a sidebar to the
		// main task; it doesn't derail.
		expect(FRICTION_REPORTING_GUIDANCE).toContain(
			'only let friction block your task if it actually blocks it',
		);

		// Negative scoping intentionally REMOVED (was: "Do not report core
		// task difficulty, expected debugging effort, product ambiguity..."
		// — that was the source of under-reporting, surfaced live on
		// 2026-05-10 PR #1303 where the implementation agent hit a
		// CASCADE_ORG_ID env-var leak in tests, worked around it with
		// `env -u`, and reported it in the PR body instead of via
		// ReportFriction).
		expect(FRICTION_REPORTING_GUIDANCE).not.toContain('Do not report');
		expect(FRICTION_REPORTING_GUIDANCE).not.toContain('only for incidental papercuts');

		// "When the ReportFriction tool is available" hedge REMOVED — the
		// guidance is only injected when the capability is effective, so
		// the conditional just creates agent doubt.
		expect(FRICTION_REPORTING_GUIDANCE).not.toContain('When the ReportFriction tool is available');
	});
});
