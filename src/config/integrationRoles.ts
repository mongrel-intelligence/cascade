export type IntegrationCategory = 'pm' | 'scm' | 'email';
export type IntegrationProvider = 'trello' | 'jira' | 'github' | 'imap';

export const PROVIDER_CATEGORY: Record<IntegrationProvider, IntegrationCategory> = {
	trello: 'pm',
	jira: 'pm',
	github: 'scm',
	imap: 'email',
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
	],
	imap: [
		{ role: 'imap_host', label: 'IMAP Host', envVarKey: 'EMAIL_IMAP_HOST' },
		{ role: 'imap_port', label: 'IMAP Port', envVarKey: 'EMAIL_IMAP_PORT' },
		{ role: 'smtp_host', label: 'SMTP Host', envVarKey: 'EMAIL_SMTP_HOST' },
		{ role: 'smtp_port', label: 'SMTP Port', envVarKey: 'EMAIL_SMTP_PORT' },
		{ role: 'username', label: 'Username/Email', envVarKey: 'EMAIL_USERNAME' },
		{ role: 'password', label: 'Password/App Password', envVarKey: 'EMAIL_PASSWORD' },
	],
};
