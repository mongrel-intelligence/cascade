export type IntegrationCategory = 'pm' | 'scm';
export type IntegrationProvider = 'trello' | 'jira' | 'github';

export const PROVIDER_CATEGORY: Record<IntegrationProvider, IntegrationCategory> = {
	trello: 'pm',
	jira: 'pm',
	github: 'scm',
};

export interface CredentialRoleDef {
	role: string;
	label: string;
	envVarKey: string; // used when building flat env maps for workers
}

export const PROVIDER_CREDENTIAL_ROLES: Record<IntegrationProvider, CredentialRoleDef[]> = {
	trello: [
		{ role: 'api_key', label: 'API Key', envVarKey: 'TRELLO_API_KEY' },
		{ role: 'token', label: 'Token', envVarKey: 'TRELLO_TOKEN' },
	],
	jira: [
		{ role: 'email', label: 'Email', envVarKey: 'JIRA_EMAIL' },
		{ role: 'api_token', label: 'API Token', envVarKey: 'JIRA_API_TOKEN' },
	],
	github: [
		{
			role: 'implementer_token',
			label: 'Implementer Token',
			envVarKey: 'GITHUB_TOKEN_IMPLEMENTER',
		},
		{ role: 'reviewer_token', label: 'Reviewer Token', envVarKey: 'GITHUB_TOKEN_REVIEWER' },
		{ role: 'webhook_secret', label: 'Webhook Secret', envVarKey: 'GITHUB_WEBHOOK_SECRET' },
	],
};
