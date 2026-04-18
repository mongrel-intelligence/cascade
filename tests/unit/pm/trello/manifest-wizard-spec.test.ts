/**
 * Trello manifest wizardSpec — updated for plan 011/2.
 *
 * Trello's credentials step is `kind: 'custom'` (OAuth popup flow resolved
 * by the Trello ProviderWizardDefinition). Every other step goes through
 * the shared generator.
 *
 *   custom(TrelloOAuthStep) →
 *   container-pick (searchable board picker) →
 *   status-mapping →
 *   label-mapping (with Trello label defaults) →
 *   custom-field-mapping (cost field creation) →
 *   webhook-url-display
 */

import { describe, expect, it } from 'vitest';
import type { CustomStep } from '../../../../src/integrations/pm/manifest.js';
import { trelloManifest } from '../../../../src/integrations/pm/trello/manifest.js';

describe('trelloManifest.wizardSpec', () => {
	it('is declared', () => {
		expect(trelloManifest.wizardSpec).toBeDefined();
	});

	it('includes the standard step kinds in expected order (plan 011/2)', () => {
		const kinds = trelloManifest.wizardSpec?.steps.map((s) => s.kind) ?? [];
		expect(kinds).toEqual([
			'custom',
			'container-pick',
			'status-mapping',
			'label-mapping',
			'custom-field-mapping',
			'webhook-url-display',
		]);
	});

	it('credentials step is a custom step resolving to TrelloOAuthStep', () => {
		const first = trelloManifest.wizardSpec?.steps[0];
		expect(first?.kind).toBe('custom');
		expect((first as CustomStep).component).toBe('TrelloOAuthStep');
	});

	it('each step has a stable id', () => {
		const steps = trelloManifest.wizardSpec?.steps ?? [];
		for (const step of steps) {
			expect(step.id).toBeTruthy();
		}
	});

	it('step ids are unique', () => {
		const ids = (trelloManifest.wizardSpec?.steps ?? []).map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
