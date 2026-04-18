/**
 * Linear manifest wizardSpec (plan 009/4 task 4).
 *
 * Declares the standard-step sequence including the project-scope
 * step from spec 005. Custom Linear UI (reaction config, etc.) stays
 * in the provider folder as `kind: 'custom'`.
 */

import { describe, expect, it } from 'vitest';
import { linearManifest } from '../../../../src/integrations/pm/linear/manifest.js';
import {
	renderStandardStep,
	STANDARD_STEP_COMPONENTS,
} from '../../../../web/src/components/projects/pm-providers/generator.js';

describe('linearManifest.wizardSpec', () => {
	it('is declared', () => {
		expect(linearManifest.wizardSpec).toBeDefined();
	});

	it('includes standard step kinds in the expected order (including project-scope from spec 005)', () => {
		const kinds = linearManifest.wizardSpec?.steps.map((s) => s.kind) ?? [];
		expect(kinds).toEqual([
			'credentials',
			'container-pick',
			'status-mapping',
			'label-mapping',
			'project-scope',
			'webhook-url-display',
		]);
	});

	it('each step has a stable unique id', () => {
		const ids = (linearManifest.wizardSpec?.steps ?? []).map((s) => s.id);
		expect(ids.length).toBeGreaterThan(0);
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe('Linear wizardSpec through the shared generator', () => {
	it('each declared step dispatches to the corresponding real component', () => {
		const steps = linearManifest.wizardSpec?.steps ?? [];
		expect(steps.length).toBeGreaterThan(0);
		for (const step of steps) {
			if (step.kind === 'custom') continue;
			const element = renderStandardStep(step, { providerId: 'linear' });
			// element.type is the registered component — identity check proves
			// the dispatcher routes to the right shared component.
			expect(element.type).toBe(STANDARD_STEP_COMPONENTS[step.kind]);
		}
	});

	it('project-scope step is present and dispatches to ProjectScopeStep (spec 005 preservation)', () => {
		const projectScope = linearManifest.wizardSpec?.steps.find((s) => s.kind === 'project-scope');
		expect(projectScope).toBeDefined();
		if (!projectScope) return;
		const element = renderStandardStep(projectScope, { providerId: 'linear' });
		expect(element.type).toBe(STANDARD_STEP_COMPONENTS['project-scope']);
	});
});
