/**
 * Trello wizardSpec + renderStandardStep dispatch (plan 009/2 task 5,
 * updated by plan 010/3, migrated by plan 011/2).
 *
 * Post plan 011/2: Trello's ProviderWizardDefinition consumes the shared
 * step components via `renderStandardStep` + `STANDARD_STEP_COMPONENTS`.
 * The credentials step is `kind: 'custom'` → resolved to `TrelloOAuthStep`
 * at render time. This test locks in both paths.
 */

import { describe, expect, it } from 'vitest';
import { trelloManifest } from '../../../src/integrations/pm/trello/manifest.js';
import {
	renderStandardStep,
	STANDARD_STEP_COMPONENTS,
} from '../../../web/src/components/projects/pm-providers/generator.js';
import { TrelloOAuthStep } from '../../../web/src/components/projects/pm-providers/trello/oauth-step.js';
import { trelloProviderWizard } from '../../../web/src/components/projects/pm-providers/trello/wizard.js';

describe('Trello wizardSpec through the shared generator (post plan 011/2)', () => {
	it('each declared standard step dispatches to the corresponding real shared component', () => {
		const steps = trelloManifest.wizardSpec?.steps ?? [];
		expect(steps.length).toBeGreaterThan(0);

		for (const step of steps) {
			if (step.kind === 'custom') continue;
			const element = renderStandardStep(step, { providerId: 'trello' });
			expect(element.type).toBe(STANDARD_STEP_COMPONENTS[step.kind]);
		}
	});

	it('includes exactly one custom step (TrelloOAuthStep) for the credentials slot', () => {
		const customSteps = (trelloManifest.wizardSpec?.steps ?? []).filter((s) => s.kind === 'custom');
		expect(customSteps).toHaveLength(1);
		expect((customSteps[0] as { component: string }).component).toBe('TrelloOAuthStep');
	});

	it('declared steps use only StandardStepKinds + custom', () => {
		const allowedKinds = new Set([
			'credentials',
			'container-pick',
			'status-mapping',
			'label-mapping',
			'webhook-url-display',
			'project-scope',
			'custom-field-mapping',
			'custom',
		]);
		const steps = trelloManifest.wizardSpec?.steps ?? [];
		for (const step of steps) {
			expect(allowedKinds.has(step.kind)).toBe(true);
		}
	});

	it('step ids are unique within Trello wizardSpec', () => {
		const ids = (trelloManifest.wizardSpec?.steps ?? []).map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe('trelloProviderWizard (post plan 011/2)', () => {
	it('id matches the backend manifest', () => {
		expect(trelloProviderWizard.id).toBe(trelloManifest.id);
	});

	it('has one ProviderWizardStep per wizardSpec entry, in the same order', () => {
		const specIds = (trelloManifest.wizardSpec?.steps ?? []).map((s) => s.id);
		const wizardStepIds = trelloProviderWizard.steps.map((s) => s.id);
		expect(wizardStepIds).toEqual(specIds);
	});

	it('exposes TrelloOAuthStep as the first step Component (custom credentials)', () => {
		// The first step resolves to the custom OAuth component. Identity check.
		expect(trelloProviderWizard.steps[0]?.Component).toBe(TrelloOAuthStep);
	});
});
