import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	_resetProviderWizardRegistryForTesting,
	registerProviderWizard,
} from '../../../web/src/components/projects/pm-providers/registry.js';
import type { ProviderWizardDefinition } from '../../../web/src/components/projects/pm-providers/types.js';
import type {
	buildProviderSwitchConfirmationMessage as BuildConfirmationMessage,
	ProviderPicker as ProviderPickerComponent,
} from '../../../web/src/components/projects/pm-wizard.js';
import { createInitialState } from '../../../web/src/components/projects/pm-wizard-state.js';

let ProviderPicker: typeof ProviderPickerComponent;
let buildProviderSwitchConfirmationMessage: typeof BuildConfirmationMessage;

function StubStep({ state }: { state: { provider: string } }) {
	return createElement(
		'div',
		{ 'data-testid': `${state.provider}-stub-step` },
		`stub-${state.provider}`,
	);
}

function makeStubWizard(id: string, label: string): ProviderWizardDefinition {
	return {
		id,
		label,
		steps: [
			{ id: 'credentials', title: 'Credentials', Component: StubStep, isComplete: () => true },
		],
		auth: {
			rawCredentials: [{ role: 'api_key', stateField: 'linearApiKey' }],
			storedCredentials: { fallbackWhenStateFieldEmpty: 'linearApiKey' },
			missingCredentialsMessage: 'Missing credentials',
		},
		formatVerificationDisplay: (me) => me.displayName ?? me.name,
		credentialPersistence: [
			{ envVarKey: 'STUB_API_KEY', stateField: 'linearApiKey', label: 'Stub API Key' },
		],
		buildIntegrationConfig: () => ({}),
		isSetupComplete: () => true,
	};
}

function renderProviderPicker() {
	return renderToStaticMarkup(
		createElement(ProviderPicker, {
			state: createInitialState(),
			dispatch: vi.fn(),
			advanceToStep: vi.fn(),
		}),
	);
}

describe('PMWizard provider picker', () => {
	beforeAll(async () => {
		({ ProviderPicker, buildProviderSwitchConfirmationMessage } = await import(
			'../../../web/src/components/projects/pm-wizard.js'
		));
	});

	beforeEach(() => {
		_resetProviderWizardRegistryForTesting();
		registerProviderWizard(makeStubWizard('trello', 'Trello'));
	});

	afterEach(() => {
		_resetProviderWizardRegistryForTesting();
	});

	afterAll(() => {
		_resetProviderWizardRegistryForTesting();
	});

	it('renders every provider returned by the provider wizard registry', () => {
		registerProviderWizard(makeStubWizard('acme', 'Acme PM'));

		const html = renderProviderPicker();

		expect(html).toContain('>Trello</button>');
		expect(html).toContain('>Acme PM</button>');
	});

	it('builds provider switch confirmation copy from provider definition labels', () => {
		expect(buildProviderSwitchConfirmationMessage('Trello', 'Acme PM')).toBe(
			"Switch PM provider from Trello to Acme PM?\n\nYou'll need to re-enter credentials and re-map fields for Acme PM. The old provider's credentials will be deleted when you save.",
		);
	});
});
