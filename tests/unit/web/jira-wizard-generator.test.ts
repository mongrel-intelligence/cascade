/**
 * JIRA wizard — post plan 011/3 migration to shared components.
 *
 * JIRA had zero dedicated legacy wizard-step tests before plan 011/3.
 * This file is the new coverage for the migrated wizard definition.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { jiraManifest } from '../../../src/integrations/pm/jira/manifest.js';
import {
	renderStandardStep,
	STANDARD_STEP_COMPONENTS,
} from '../../../web/src/components/projects/pm-providers/generator.js';
import { IssueTypeMappingStep } from '../../../web/src/components/projects/pm-providers/jira/issue-type-step.js';
import { jiraProviderWizard } from '../../../web/src/components/projects/pm-providers/jira/wizard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const JIRA_HOOKS_PATH = resolve(
	REPO_ROOT,
	'web/src/components/projects/pm-providers/jira/hooks.ts',
);
const JIRA_WIZARD_PATH = resolve(
	REPO_ROOT,
	'web/src/components/projects/pm-providers/jira/wizard.ts',
);
const PM_WIZARD_HOOKS_PATH = resolve(REPO_ROOT, 'web/src/components/projects/pm-wizard-hooks.ts');

describe('JIRA wizardSpec through the shared generator (post plan 011/3)', () => {
	it('each declared standard step dispatches to the corresponding real shared component', () => {
		const steps = jiraManifest.wizardSpec?.steps ?? [];
		expect(steps.length).toBeGreaterThan(0);

		for (const step of steps) {
			if (step.kind === 'custom') continue;
			const element = renderStandardStep(step, { providerId: 'jira' });
			expect(element.type).toBe(STANDARD_STEP_COMPONENTS[step.kind]);
		}
	});

	it('declares its custom steps in order: routing, then issue types', () => {
		// Spec 024 plan 5 adds the shared-key routing step. Both are provider-owned
		// components rather than StandardStepKinds because JIRA is the only
		// provider with either concept today.
		const customSteps = (jiraManifest.wizardSpec?.steps ?? []).filter((s) => s.kind === 'custom');
		expect(customSteps.map((s) => (s as { component: string }).component)).toEqual([
			'RoutingStep',
			'IssueTypeMappingStep',
		]);
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
		const steps = jiraManifest.wizardSpec?.steps ?? [];
		for (const step of steps) {
			expect(allowedKinds.has(step.kind)).toBe(true);
		}
	});

	it('step ids are unique within JIRA wizardSpec', () => {
		const ids = (jiraManifest.wizardSpec?.steps ?? []).map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe('jiraProviderWizard (post plan 011/3)', () => {
	it('id matches the backend manifest', () => {
		expect(jiraProviderWizard.id).toBe(jiraManifest.id);
	});

	it('has one ProviderWizardStep per wizardSpec entry, in the same order', () => {
		const specIds = (jiraManifest.wizardSpec?.steps ?? []).map((s) => s.id);
		const wizardStepIds = jiraProviderWizard.steps.map((s) => s.id);
		expect(wizardStepIds).toEqual(specIds);
	});

	it('exposes IssueTypeMappingStep as the resolved custom step', () => {
		// The wizard definition wraps IssueTypeMappingStep in a thin adapter
		// (JiraIssueTypeAdapter) that pulls issue-type data off providerHooks.
		// The wizardSpec's custom step names the underlying component name.
		const issueTypeStep = jiraProviderWizard.steps.find((s) => s.id === 'jira-issue-types');
		expect(issueTypeStep).toBeDefined();
		expect(issueTypeStep?.title).toBe('Issue types');
		// Import identity check — the target step component is reachable at
		// the expected path (used by the provider's own adapter).
		expect(IssueTypeMappingStep.name).toBe('IssueTypeMappingStep');
	});

	it('has useProviderHooks declared', () => {
		expect(jiraProviderWizard.useProviderHooks).toBeDefined();
	});
});

describe('jiraProviderWizard provider-owned hooks', () => {
	it('imports JIRA-specific hooks from the JIRA provider folder', () => {
		const source = readFileSync(JIRA_WIZARD_PATH, 'utf8');
		expect(source).toContain("} from './hooks.js'");
		expect(source).not.toContain("} from '../../pm-wizard-hooks.js'");
	});

	it('keeps JIRA-specific hook definitions out of the shared wizard hook module', () => {
		const jiraHooks = readFileSync(JIRA_HOOKS_PATH, 'utf8');
		const sharedHooks = readFileSync(PM_WIZARD_HOOKS_PATH, 'utf8');

		for (const hookName of ['useJiraDiscovery', 'useJiraCustomFieldCreation']) {
			expect(jiraHooks).toContain(`export function ${hookName}`);
			expect(sharedHooks).not.toContain(`export function ${hookName}`);
		}
	});
});
