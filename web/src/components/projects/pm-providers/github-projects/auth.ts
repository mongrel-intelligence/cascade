import type { ProviderAuthMetadata, ProviderCredentialPersistenceMapping } from '../types.js';

export const githubProjectsAuthMetadata: ProviderAuthMetadata = {
	rawCredentials: [{ role: 'token', stateField: 'githubProjectsToken' }],
	storedCredentials: { fallbackWhenStateFieldEmpty: 'githubProjectsToken' },
	missingCredentialsMessage: 'Enter your GitHub Personal Access Token before verifying',
};

export const githubProjectsCredentialPersistence: readonly ProviderCredentialPersistenceMapping[] =
	[
		{
			envVarKey: 'GITHUB_TOKEN',
			stateField: 'githubProjectsToken',
			label: 'GitHub Personal Access Token',
		},
	];
