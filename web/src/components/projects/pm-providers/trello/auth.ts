import type { ProviderAuthMetadata, ProviderCredentialPersistenceMapping } from '../types.js';

export const trelloAuthMetadata: ProviderAuthMetadata = {
	rawCredentials: [
		{ role: 'api_key', stateField: 'trelloApiKey' },
		{ role: 'token', stateField: 'trelloToken' },
	],
	storedCredentials: { fallbackWhenStateFieldEmpty: 'trelloApiKey' },
	missingCredentialsMessage: 'Enter both credentials before verifying',
};

export const trelloCredentialPersistence: readonly ProviderCredentialPersistenceMapping[] = [
	{ envVarKey: 'TRELLO_API_KEY', stateField: 'trelloApiKey', label: 'Trello API Key' },
	{ envVarKey: 'TRELLO_TOKEN', stateField: 'trelloToken', label: 'Trello Token' },
];
