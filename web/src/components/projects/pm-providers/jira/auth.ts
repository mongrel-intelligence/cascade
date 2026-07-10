import type { ProviderAuthMetadata, ProviderCredentialPersistenceMapping } from '../types.js';

export const jiraAuthMetadata: ProviderAuthMetadata = {
	rawCredentials: [
		{ role: 'email', stateField: 'jiraEmail' },
		{ role: 'api_token', stateField: 'jiraApiToken' },
		{ role: 'base_url', stateField: 'jiraBaseUrl' },
		// Non-secret connection setting (mirrors base_url). Always has a value
		// (defaults to 'basic'), so verify-button readiness is unaffected and the
		// verify credential bag auto-includes auth_type for host routing.
		{ role: 'auth_type', stateField: 'jiraAuthType' },
	],
	storedCredentials: { fallbackWhenStateFieldEmpty: 'jiraEmail' },
	missingCredentialsMessage: 'Enter both credentials before verifying',
};

export const jiraCredentialPersistence: readonly ProviderCredentialPersistenceMapping[] = [
	{ envVarKey: 'JIRA_EMAIL', stateField: 'jiraEmail', label: 'JIRA Email' },
	{ envVarKey: 'JIRA_API_TOKEN', stateField: 'jiraApiToken', label: 'JIRA API Token' },
];
