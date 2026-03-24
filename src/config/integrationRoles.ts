export type IntegrationCategory = 'pm' | 'scm' | 'alerting';
export type IntegrationProvider = 'trello' | 'jira' | 'github' | 'sentry';

export interface CredentialRoleDef {
	role: string;
	label: string;
	envVarKey: string; // used when building flat env maps for workers
	/** When true, this credential is not required for the integration to be considered complete. */
	optional?: boolean;
}

// ---------------------------------------------------------------------------
// Internal registry — mutable map backing the public accessors
// ---------------------------------------------------------------------------

const _rolesRegistry = new Map<string, CredentialRoleDef[]>([
	[
		'trello',
		[
			{ role: 'api_key', label: 'API Key', envVarKey: 'TRELLO_API_KEY' },
			{ role: 'api_secret', label: 'API Secret', envVarKey: 'TRELLO_API_SECRET', optional: true },
			{ role: 'token', label: 'Token', envVarKey: 'TRELLO_TOKEN' },
		],
	],
	[
		'jira',
		[
			{ role: 'email', label: 'Email', envVarKey: 'JIRA_EMAIL' },
			{ role: 'api_token', label: 'API Token', envVarKey: 'JIRA_API_TOKEN' },
			{
				role: 'webhook_secret',
				label: 'Webhook Secret',
				envVarKey: 'JIRA_WEBHOOK_SECRET',
				optional: true,
			},
		],
	],
	[
		'github',
		[
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
	],
	[
		'sentry',
		[
			{ role: 'api_token', label: 'API Token', envVarKey: 'SENTRY_API_TOKEN' },
			{
				role: 'webhook_secret',
				label: 'Webhook Secret',
				envVarKey: 'SENTRY_WEBHOOK_SECRET',
				optional: true,
			},
		],
	],
]);

const _categoryRegistry = new Map<string, IntegrationCategory>([
	['trello', 'pm'],
	['jira', 'pm'],
	['github', 'scm'],
	['sentry', 'alerting'],
]);

// ---------------------------------------------------------------------------
// Self-registration API
// ---------------------------------------------------------------------------

/**
 * Register credential roles for a provider. Intended to be called at bootstrap
 * time so new integrations can self-register without hardcoded changes here.
 *
 * @param provider  - Provider identifier string (e.g. 'linear', 'clickup')
 * @param category  - Integration category ('pm', 'scm', or 'alerting')
 * @param roles     - Credential role definitions for the provider
 */
export function registerCredentialRoles(
	provider: string,
	category: IntegrationCategory,
	roles: CredentialRoleDef[],
): void {
	_rolesRegistry.set(provider, roles);
	_categoryRegistry.set(provider, category);
}

/**
 * Retrieve credential roles for a provider.
 * Returns an empty array if the provider is not registered.
 *
 * Accepts any string so callers working with dynamically registered providers
 * are not constrained to the hardcoded IntegrationProvider union type.
 */
export function getCredentialRoles(provider: string): CredentialRoleDef[] {
	return _rolesRegistry.get(provider) ?? [];
}

// ---------------------------------------------------------------------------
// Backward-compatible accessors
// ---------------------------------------------------------------------------

/**
 * Proxy-backed accessor that preserves the existing `Record<IntegrationProvider, CredentialRoleDef[]>`
 * access pattern while reading from the mutable registry underneath.
 *
 * All existing `PROVIDER_CREDENTIAL_ROLES[provider]` usages continue to work unchanged.
 */
export const PROVIDER_CREDENTIAL_ROLES: Record<IntegrationProvider, CredentialRoleDef[]> =
	new Proxy({} as Record<IntegrationProvider, CredentialRoleDef[]>, {
		get(_target, prop: string) {
			return _rolesRegistry.get(prop) ?? [];
		},
		has(_target, prop: string) {
			return _rolesRegistry.has(prop);
		},
		ownKeys(_target) {
			return [..._rolesRegistry.keys()];
		},
		getOwnPropertyDescriptor(_target, prop: string) {
			if (_rolesRegistry.has(prop)) {
				return { enumerable: true, configurable: true, writable: false };
			}
			return undefined;
		},
	});

/**
 * Proxy-backed accessor that preserves the existing `Record<IntegrationProvider, IntegrationCategory>`
 * access pattern while reading from the mutable registry underneath.
 *
 * All existing `PROVIDER_CATEGORY[provider]` usages continue to work unchanged.
 */
export const PROVIDER_CATEGORY: Record<IntegrationProvider, IntegrationCategory> = new Proxy(
	{} as Record<IntegrationProvider, IntegrationCategory>,
	{
		get(_target, prop: string) {
			return _categoryRegistry.get(prop);
		},
		has(_target, prop: string) {
			return _categoryRegistry.has(prop);
		},
		ownKeys(_target) {
			return [..._categoryRegistry.keys()];
		},
		getOwnPropertyDescriptor(_target, prop: string) {
			if (_categoryRegistry.has(prop)) {
				return { enumerable: true, configurable: true, writable: false };
			}
			return undefined;
		},
	},
);
