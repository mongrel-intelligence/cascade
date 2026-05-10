import { beforeEach, describe, expect, it } from 'vitest';
import {
	_resetProviderWizardRegistryForTesting,
	getProviderWizard,
	listProviderWizards,
	registerProviderWizard,
} from '../../../web/src/components/projects/pm-providers/registry.js';
import type { ProviderWizardDefinition } from '../../../web/src/components/projects/pm-providers/types.js';

function makeStubWizard(id: string): ProviderWizardDefinition {
	return {
		id,
		label: id,
		steps: [],
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

describe('providerWizardRegistry', () => {
	beforeEach(() => {
		_resetProviderWizardRegistryForTesting();
	});

	it('registers and lists wizards in registration order', () => {
		registerProviderWizard(makeStubWizard('alpha'));
		registerProviderWizard(makeStubWizard('beta'));
		expect(listProviderWizards().map((w) => w.id)).toEqual(['alpha', 'beta']);
	});

	it('getProviderWizard returns null for unknown id; returns the wizard by id', () => {
		const w = makeStubWizard('alpha');
		registerProviderWizard(w);
		expect(getProviderWizard('alpha')).toBe(w);
		expect(getProviderWizard('unknown')).toBeNull();
	});
});
