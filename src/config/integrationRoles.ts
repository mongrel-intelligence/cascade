export type IntegrationCategory = 'pm' | 'scm' | 'alerting';
export type IntegrationProvider = 'trello' | 'jira' | 'github' | 'sentry';

export const PROVIDER_CATEGORY: Record<IntegrationProvider, IntegrationCategory> = {
	trello: 'pm',
	jira: 'pm',
	github: 'scm',
	sentry: 'alerting',
};

export interface CredentialRoleDef {
	role: string;
	label: string;
	envVarKey: string; // used when building flat env maps for workers
	/** When true, this credential is not required for the integration to be considered complete. */
	optional?: boolean;
}

export const PROVIDER_CREDENTIAL_ROLES: Record<IntegrationProvider, CredentialRoleDef[]> = {
	trello: [
		{ role: 'api_key', label: 'API Key', envVarKey: 'TRELLO_API_KEY' },
		{ role: 'api_secret', label: 'API Secret', envVarKey: 'TRELLO_API_SECRET', optional: true },
		{ role: 'token', label: 'Token', envVarKey: 'TRELLO_TOKEN' },
	],
	jira: [
		{ role: 'email', label: 'Email', envVarKey: 'JIRA_EMAIL' },
		{ role: 'api_token', label: 'API Token', envVarKey: 'JIRA_API_TOKEN' },
		{
			role: 'webhook_secret',
			label: 'Webhook Secret',
			envVarKey: 'JIRA_WEBHOOK_SECRET',
			optional: true,
		},
	],
	github: [
		{
			role: 'implementer_token',
			label: 'Implementer Token',
			envVarKey: 'GITHUB_TOKEN_IMPLEMENTER',
		},
		{ role: 'reviewer_token', label: 'Reviewer Token', envVarKey: 'GITHUB_TOKEN_REVIEWER' },
		{
			role: 'webhook_secret',
			label: 'Webhook Secret',
			envVarKey: 'GITHUB_WEBHOOK_SECRET',
			optional: true,
		},
	],
	sentry: [
		{ role: 'api_token', label: 'API Token', envVarKey: 'SENTRY_API_TOKEN' },
		{
			role: 'webhook_secret',
			label: 'Webhook Secret',
			envVarKey: 'SENTRY_WEBHOOK_SECRET',
			optional: true,
		},
	],
};
