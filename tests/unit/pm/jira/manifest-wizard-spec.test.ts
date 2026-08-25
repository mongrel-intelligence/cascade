/**
 * JIRA manifest wizardSpec — updated for plan 011/3.
 *
 * Post plan 011/3:
 *   credentials →
 *   container-pick (searchable project picker) →
 *   status-mapping →
 *   label-mapping (free-text mode — JIRA labels are free-form) →
 *   custom-field-mapping (cost field creation, admin-only) →
 *   custom(IssueTypeMappingStep) — task/subtask issue-type mapping →
 *   webhook-url-display
 */

import { describe, expect, it } from 'vitest';
import { jiraManifest } from '../../../../src/integrations/pm/jira/manifest.js';
import type { CustomStep } from '../../../../src/integrations/pm/manifest.js';
import {
	renderStandardStep,
	STANDARD_STEP_COMPONENTS,
} from '../../../../web/src/components/projects/pm-providers/generator.js';

describe('jiraManifest.wizardSpec', () => {
	it('is declared', () => {
		expect(jiraManifest.wizardSpec).toBeDefined();
	});

	it('includes the standard step kinds in expected order (plan 011/3)', () => {
		const kinds = jiraManifest.wizardSpec?.steps.map((s) => s.kind) ?? [];
		expect(kinds).toEqual([
			'credentials',
			'container-pick',
			'status-mapping',
			// Spec 024 plan 5: the shared-key routing discriminator, placed after
			// status mapping so it reads as a peer of the other scoping steps.
			'custom',
			'label-mapping',
			'custom-field-mapping',
			'custom',
			'webhook-url-display',
		]);
	});

	it('resolves its custom steps to provider-owned components', () => {
		const customSteps = (jiraManifest.wizardSpec?.steps ?? []).filter((s) => s.kind === 'custom');
		expect(customSteps.map((s) => (s as CustomStep).component)).toEqual([
			'RoutingStep',
			'IssueTypeMappingStep',
		]);
	});

	it('each step has a stable id', () => {
		const steps = jiraManifest.wizardSpec?.steps ?? [];
		for (const step of steps) {
			expect(step.id).toBeTruthy();
		}
	});

	it('step ids are unique', () => {
		const ids = (jiraManifest.wizardSpec?.steps ?? []).map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe('JIRA wizardSpec through the shared generator', () => {
	it('each declared standard step dispatches to the corresponding real component', () => {
		const steps = jiraManifest.wizardSpec?.steps ?? [];
		expect(steps.length).toBeGreaterThan(0);
		for (const step of steps) {
			if (step.kind === 'custom') continue;
			const element = renderStandardStep(step, { providerId: 'jira' });
			expect(element.type).toBe(STANDARD_STEP_COMPONENTS[step.kind]);
		}
	});
});
