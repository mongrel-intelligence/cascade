/**
 * Trello wizardSpec + renderStandardStep dispatch (plan 009/2 task 5,
 * updated by plan 010/3).
 *
 * Verifies that every step declared on `trelloManifest.wizardSpec`
 * dispatches through the shared generator (`renderStandardStep`) to a
 * real shared component. The existing Trello wizard continues to use
 * its per-provider step adapters (`pm-wizard-trello-steps.tsx`) for the
 * actual UI — this test proves the wizardSpec is correctly wired to the
 * shared component registry so a future migration can swap in the
 * shared components without edits to the manifest.
 */

import { describe, expect, it } from 'vitest';
import { trelloManifest } from '../../../src/integrations/pm/trello/manifest.js';
import {
	renderStandardStep,
	STANDARD_STEP_COMPONENTS,
} from '../../../web/src/components/projects/pm-providers/generator.js';

describe('Trello wizardSpec through the shared generator', () => {
	it('each declared step dispatches to the corresponding real component', () => {
		const steps = trelloManifest.wizardSpec?.steps ?? [];
		expect(steps.length).toBeGreaterThan(0);

		for (const step of steps) {
			if (step.kind === 'custom') continue;
			const element = renderStandardStep(step, { providerId: 'trello' });
			// element.type is the registered component — identity check proves
			// the dispatcher routes to the right shared component.
			expect(element.type).toBe(STANDARD_STEP_COMPONENTS[step.kind]);
		}
	});

	it('declared steps use only known StandardStepKinds (no custom in plan 2 scope)', () => {
		const knownKinds = new Set([
			'credentials',
			'container-pick',
			'status-mapping',
			'label-mapping',
			'webhook-url-display',
			'project-scope',
		]);
		const steps = trelloManifest.wizardSpec?.steps ?? [];
		for (const step of steps) {
			expect(knownKinds.has(step.kind)).toBe(true);
		}
	});

	it('step ids are unique within Trello wizardSpec', () => {
		const ids = (trelloManifest.wizardSpec?.steps ?? []).map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
