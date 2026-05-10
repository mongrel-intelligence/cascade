/**
 * Linear wizard — post plan 011/4 migration to shared components.
 *
 * Replaces three retired legacy step tests (linear-field-mapping-step,
 * linear-team-step, linear-webhook-info-panel). The shared components
 * have their own dedicated tests in tests/unit/web/steps/; this file
 * focuses on the Linear-specific wizard wiring.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const LINEAR_WIZARD_PATH = resolve(
	REPO_ROOT,
	'web/src/components/projects/pm-providers/linear/wizard.ts',
);
const LINEAR_HOOKS_PATH = resolve(
	REPO_ROOT,
	'web/src/components/projects/pm-providers/linear/hooks.ts',
);
const PM_WIZARD_HOOKS_PATH = resolve(REPO_ROOT, 'web/src/components/projects/pm-wizard-hooks.ts');

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

describe('linearProviderWizard — webhook URL construction guard', () => {
	// Linear's API forbids programmatic webhook registration so the user copies
	// the URL manually into linear.app. The URL must point at the router server
	// (API_URL / VITE_API_URL), not the dashboard origin, and must use the
	// correct path /linear/webhook — not the project-scoped /webhooks/{id}/linear
	// pattern that was briefly wrong.

	it('uses API_URL (router origin) not window.location.origin for webhookUrl', () => {
		const source = readFileSync(LINEAR_WIZARD_PATH, 'utf8');
		// Must import API_URL
		expect(source, 'API_URL must be imported').toContain("import { API_URL } from '@/lib/api.js'");
		// Must use it to build the base
		expect(source, 'routerOrigin must be derived from API_URL').toContain('API_URL ||');
	});

	it('uses /linear/webhook path not /webhooks/{projectId}/linear', () => {
		const source = readFileSync(LINEAR_WIZARD_PATH, 'utf8');
		expect(source, '/linear/webhook must be the path').toContain('/linear/webhook');
		expect(
			source,
			'/webhooks/{projectId}/linear must not appear — wrong path and wrong origin',
		).not.toContain('/webhooks/');
	});
});

describe('linearProviderWizard provider-owned hooks', () => {
	it('imports Linear-specific hooks from the Linear provider folder', () => {
		const source = readFileSync(LINEAR_WIZARD_PATH, 'utf8');
		expect(source).toContain("} from './hooks.js'");
		expect(source).not.toContain("} from '../../pm-wizard-hooks.js'");
	});

	it('keeps Linear-specific hook definitions out of the shared wizard hook module', () => {
		const linearHooks = readFileSync(LINEAR_HOOKS_PATH, 'utf8');
		const sharedHooks = readFileSync(PM_WIZARD_HOOKS_PATH, 'utf8');

		for (const hookName of ['useLinearDiscovery', 'useLinearLabelCreation']) {
			expect(linearHooks).toContain(`export function ${hookName}`);
			expect(sharedHooks).not.toContain(`export function ${hookName}`);
		}
	});
});
