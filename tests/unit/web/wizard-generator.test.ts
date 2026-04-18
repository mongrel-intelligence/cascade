/**
 * Tests the wizard step generator.
 *
 * Plan 009/1 shipped dormant scaffolding (placeholders). Plan 010/3
 * upgraded the generator to dispatch to real shared components. The
 * tests here guard the current invariants:
 *
 *   1. `STANDARD_STEP_COMPONENTS` exposes one real component per
 *      StandardStepKind.
 *   2. `renderStandardStep` returns the real component for each known
 *      kind (asserted via element.type identity).
 *   3. Custom steps return a placeholder that references the custom
 *      component name.
 *   4. Unknown kinds log a console.warn once and return a placeholder
 *      rather than crashing the wizard.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomStep, StandardStep } from '../../../src/integrations/pm/manifest.js';
import {
	renderStandardStep,
	STANDARD_STEP_COMPONENTS,
} from '../../../web/src/components/projects/pm-providers/generator.js';
import { ContainerPickStep } from '../../../web/src/components/projects/pm-providers/steps/container-pick.js';
import { CredentialsStep } from '../../../web/src/components/projects/pm-providers/steps/credentials.js';
import { LabelMappingStep } from '../../../web/src/components/projects/pm-providers/steps/label-mapping.js';
import { ProjectScopeStep } from '../../../web/src/components/projects/pm-providers/steps/project-scope.js';
import { StatusMappingStep } from '../../../web/src/components/projects/pm-providers/steps/status-mapping.js';
import { WebhookUrlDisplayStep } from '../../../web/src/components/projects/pm-providers/steps/webhook-url-display.js';

describe('STANDARD_STEP_COMPONENTS registry (plan 010/3)', () => {
	it('maps every StandardStepKind to the corresponding real component', () => {
		expect(STANDARD_STEP_COMPONENTS.credentials).toBe(CredentialsStep);
		expect(STANDARD_STEP_COMPONENTS['container-pick']).toBe(ContainerPickStep);
		expect(STANDARD_STEP_COMPONENTS['status-mapping']).toBe(StatusMappingStep);
		expect(STANDARD_STEP_COMPONENTS['label-mapping']).toBe(LabelMappingStep);
		expect(STANDARD_STEP_COMPONENTS['webhook-url-display']).toBe(WebhookUrlDisplayStep);
		expect(STANDARD_STEP_COMPONENTS['project-scope']).toBe(ProjectScopeStep);
	});
});

describe('renderStandardStep (plan 010/3)', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it.each([
		['credentials', CredentialsStep],
		['container-pick', ContainerPickStep],
		['status-mapping', StatusMappingStep],
		['label-mapping', LabelMappingStep],
		['webhook-url-display', WebhookUrlDisplayStep],
		['project-scope', ProjectScopeStep],
	] as const)('dispatches %s to the corresponding real component', (kind, Component) => {
		const step: StandardStep = { kind, id: `step-${kind}` };
		const element = renderStandardStep(step, { providerId: 'new-provider' });
		// element.type is the React component function/class reference.
		expect(element.type).toBe(Component);
	});

	it('forwards providerHooks into the component as props', () => {
		// Provide enough props for credentials to render meaningfully.
		const step: StandardStep = { kind: 'credentials', id: 'creds' };
		const element = renderStandardStep(step, {
			providerId: 'new-provider',
			providerHooks: {
				credentialRoles: [{ role: 'api_key', label: 'API Key' }],
				values: { api_key: 'k' },
				onChange: () => {},
			},
		});
		const html = renderToStaticMarkup(element);
		expect(html).toContain('data-role="api_key"');
		expect(html).toContain('value="k"');
	});

	it('renders a placeholder for a custom step that names the component', () => {
		const step: CustomStep = { kind: 'custom', id: 'step-custom', component: 'MySpecialStep' };
		const element = renderStandardStep(step, { providerId: 'fake' });
		const html = renderToStaticMarkup(element);
		expect(html).toContain('MySpecialStep');
	});

	it('logs a console.warn once for unknown kinds', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const unknownStep = { kind: 'unknown-kind', id: 'weird' } as unknown as StandardStep;
		renderStandardStep(unknownStep, { providerId: 'fake-duplicate-warn-provider' });
		renderStandardStep(unknownStep, { providerId: 'fake-duplicate-warn-provider' });
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy.mock.calls[0]?.[0]).toContain('unknown-kind');
	});

	it('does not throw when dispatching any known kind with minimum context', () => {
		const step: StandardStep = { kind: 'credentials', id: 'creds' };
		expect(() =>
			renderStandardStep(step, {
				providerId: 'fake',
				providerHooks: {
					credentialRoles: [],
					values: {},
					onChange: () => {},
				},
			}),
		).not.toThrow();
	});
});
