/**
 * Linear wizard — post plan 011/4 migration to shared components.
 *
 * Replaces three retired legacy step tests (linear-field-mapping-step,
 * linear-team-step, linear-webhook-info-panel). The shared components
 * have their own dedicated tests in tests/unit/web/steps/; this file
 * focuses on the Linear-specific wizard wiring.
 */

import { describe, expect, it } from 'vitest';
import { linearManifest } from '../../../src/integrations/pm/linear/manifest.js';
import {
	renderStandardStep,
	STANDARD_STEP_COMPONENTS,
} from '../../../web/src/components/projects/pm-providers/generator.js';
import { linearProviderWizard } from '../../../web/src/components/projects/pm-providers/linear/wizard.js';

describe('Linear wizardSpec through the shared generator (post plan 011/4)', () => {
	it('each declared standard step dispatches to the corresponding real shared component', () => {
		const steps = linearManifest.wizardSpec?.steps ?? [];
		expect(steps.length).toBeGreaterThan(0);

		for (const step of steps) {
			if (step.kind === 'custom') continue;
			const element = renderStandardStep(step, { providerId: 'linear' });
			expect(element.type).toBe(STANDARD_STEP_COMPONENTS[step.kind]);
		}
	});

	it('declared steps use only standard kinds (no custom steps for Linear)', () => {
		const allowedKinds = new Set([
			'credentials',
			'container-pick',
			'status-mapping',
			'label-mapping',
			'webhook-url-display',
			'project-scope',
			'custom-field-mapping',
		]);
		const steps = linearManifest.wizardSpec?.steps ?? [];
		for (const step of steps) {
			expect(allowedKinds.has(step.kind)).toBe(true);
		}
	});

	it('project-scope step is declared (spec 005 preservation)', () => {
		const scope = (linearManifest.wizardSpec?.steps ?? []).find((s) => s.kind === 'project-scope');
		expect(scope).toBeDefined();
	});

	it('webhook-url-display step is declared', () => {
		const webhook = (linearManifest.wizardSpec?.steps ?? []).find(
			(s) => s.kind === 'webhook-url-display',
		);
		expect(webhook).toBeDefined();
	});
});

describe('linearProviderWizard (post plan 011/4)', () => {
	it('id matches the backend manifest', () => {
		expect(linearProviderWizard.id).toBe(linearManifest.id);
	});

	it('has one ProviderWizardStep per wizardSpec entry, in the same order', () => {
		const specIds = (linearManifest.wizardSpec?.steps ?? []).map((s) => s.id);
		const wizardStepIds = linearProviderWizard.steps.map((s) => s.id);
		expect(wizardStepIds).toEqual(specIds);
	});

	it('has useProviderHooks declared', () => {
		expect(linearProviderWizard.useProviderHooks).toBeDefined();
	});

	it('exposes adapter Components for every step (not placeholders)', () => {
		for (const step of linearProviderWizard.steps) {
			expect(step.Component).toBeTypeOf('function');
		}
	});
});
