import type { ProviderAuthMetadata, ProviderCredentialPersistenceMapping } from '../types.js';

export const linearAuthMetadata: ProviderAuthMetadata = {
	rawCredentials: [{ role: 'api_key', stateField: 'linearApiKey' }],
	storedCredentials: { fallbackWhenStateFieldEmpty: 'linearApiKey' },
	missingCredentialsMessage: 'Enter your API key before verifying',
};

export const linearCredentialPersistence: readonly ProviderCredentialPersistenceMapping[] = [
	{ envVarKey: 'LINEAR_API_KEY', stateField: 'linearApiKey', label: 'Linear API Key' },
];
