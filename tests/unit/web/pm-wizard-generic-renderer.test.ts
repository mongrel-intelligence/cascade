/**
 * Unit tests for the tiny registry-check helper that sits in front of the
 * per-provider branches in `pm-wizard.tsx`. The helper returns the
 * matching step's React element when the provider is registered, or
 * `null` when it isn't — so the caller can use `??` to fall back to the
 * legacy branch chain.
 *
 * The goal here is just to prove the seam works; integration-level SSR
 * tests for the full wizard come with each provider migration (006/2–4).
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	_resetProviderWizardRegistryForTesting,
	registerProviderWizard,
} from '../../../web/src/components/projects/pm-providers/registry.js';
import { renderManifestStep } from '../../../web/src/components/projects/pm-providers/render.js';
import type { ProviderWizardDefinition } from '../../../web/src/components/projects/pm-providers/types.js';

function StubStep({ state }: { state: { provider: string } }) {
	return createElement('div', { 'data-testid': 'stub' }, `stub-${state.provider}`);
}

function makeStubWizard(id: string): ProviderWizardDefinition {
	return {
		id,
		label: id,
		steps: [
			{ id: 'credentials', title: 'Credentials', Component: StubStep, isComplete: () => true },
			{ id: 'container', title: 'Container', Component: StubStep, isComplete: () => true },
			{ id: 'fields', title: 'Field mappings', Component: StubStep, isComplete: () => true },
		],
		auth: {
			rawCredentials: [{ role: 'api_key', stateField: 'linearApiKey' }],
			storedCredentials: { fallbackWhenStateFieldEmpty: 'linearApiKey' },
			missingCredentialsMessage: 'Missing credentials',
		},
		credentialPersistence: [
			{ envVarKey: 'STUB_API_KEY', stateField: 'linearApiKey', label: 'Stub API Key' },
		],
		buildIntegrationConfig: () => ({}),
		isSetupComplete: () => true,
	};
}

describe('renderManifestStep', () => {
	beforeEach(() => {
		_resetProviderWizardRegistryForTesting();
	});

	it('renders the manifest step component when the provider is registered', () => {
		registerProviderWizard(makeStubWizard('alpha'));
		const element = renderManifestStep('alpha', 0, { provider: 'alpha' } as never, () => {});
		expect(element).not.toBeNull();
		const html = renderToStaticMarkup(element as React.ReactElement);
		expect(html).toContain('data-testid="stub"');
		expect(html).toContain('stub-alpha');
	});

	it('returns null when the provider is not registered (caller falls back to legacy)', () => {
		const element = renderManifestStep(
			'unregistered',
			0,
			{ provider: 'unregistered' } as never,
			() => {},
		);
		expect(element).toBeNull();
	});
});
