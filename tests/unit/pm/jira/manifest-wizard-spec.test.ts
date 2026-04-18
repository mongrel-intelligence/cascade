/**
 * JIRA manifest wizardSpec (plan 009/3 task 4).
 *
 * Declares the standard-step sequence the generic generator renders:
 * credentials → project-pick → status-mapping → label-mapping →
 * webhook-url. JIRA-specific UI (if any) stays in the provider folder
 * as `kind: 'custom'` steps.
 */

import { describe, expect, it } from 'vitest';
import { jiraManifest } from '../../../../src/integrations/pm/jira/manifest.js';
import {
	renderStandardStep,
	STANDARD_STEP_COMPONENTS,
} from '../../../../web/src/components/projects/pm-providers/generator.js';

describe('jiraManifest.wizardSpec', () => {
	it('is declared', () => {
		expect(jiraManifest.wizardSpec).toBeDefined();
	});

	it('includes the standard step kinds in expected order', () => {
		const kinds = jiraManifest.wizardSpec?.steps.map((s) => s.kind) ?? [];
		expect(kinds).toEqual([
			'credentials',
			'container-pick',
			'status-mapping',
			'label-mapping',
			'webhook-url-display',
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
	it('each declared step dispatches to the corresponding real component', () => {
		const steps = jiraManifest.wizardSpec?.steps ?? [];
		expect(steps.length).toBeGreaterThan(0);
		for (const step of steps) {
			if (step.kind === 'custom') continue;
			const element = renderStandardStep(step, { providerId: 'jira' });
			// element.type is the registered component — identity check proves
			// the dispatcher routes to the right shared component.
			expect(element.type).toBe(STANDARD_STEP_COMPONENTS[step.kind]);
		}
	});
});
