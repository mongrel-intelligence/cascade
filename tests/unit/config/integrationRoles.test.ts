import { afterEach, describe, expect, it } from 'vitest';

import {
	type IntegrationCategory,
	type IntegrationProvider,
	PROVIDER_CATEGORY,
	PROVIDER_CREDENTIAL_ROLES,
	getCredentialRoles,
	registerCredentialRoles,
} from '../../../src/config/integrationRoles.js';

// ---------------------------------------------------------------------------
// PROVIDER_CATEGORY
// ---------------------------------------------------------------------------

describe.concurrent('PROVIDER_CATEGORY', () => {
	it('maps trello to pm category', () => {
		expect(PROVIDER_CATEGORY.trello).toBe('pm');
	});

	it('maps jira to pm category', () => {
		expect(PROVIDER_CATEGORY.jira).toBe('pm');
	});

	it('maps github to scm category', () => {
		expect(PROVIDER_CATEGORY.github).toBe('scm');
	});

	it('maps all known providers to valid categories', () => {
		const validCategories: IntegrationCategory[] = ['pm', 'scm', 'alerting'];
		for (const [provider, category] of Object.entries(PROVIDER_CATEGORY)) {
			expect(validCategories).toContain(category);
		}
	});

	it('contains all expected providers', () => {
		const expectedProviders: IntegrationProvider[] = ['trello', 'jira', 'github', 'sentry'];
		for (const provider of expectedProviders) {
			expect(PROVIDER_CATEGORY).toHaveProperty(provider);
		}
	});
});

// ---------------------------------------------------------------------------
// PROVIDER_CREDENTIAL_ROLES
// ---------------------------------------------------------------------------

describe.concurrent('PROVIDER_CREDENTIAL_ROLES', () => {
	it('every provider has at least one credential role', () => {
		for (const [provider, roles] of Object.entries(PROVIDER_CREDENTIAL_ROLES)) {
			expect(roles.length, `${provider} should have at least one role`).toBeGreaterThan(0);
		}
	});

	it('each credential role has a non-empty role string', () => {
		for (const [provider, roles] of Object.entries(PROVIDER_CREDENTIAL_ROLES)) {
			for (const roleDef of roles) {
				expect(
					roleDef.role.trim(),
					`${provider}.${roleDef.role} role should be non-empty`,
				).not.toBe('');
			}
		}
	});

	it('each credential role has a non-empty label string', () => {
		for (const [provider, roles] of Object.entries(PROVIDER_CREDENTIAL_ROLES)) {
			for (const roleDef of roles) {
				expect(
					roleDef.label.trim(),
					`${provider}.${roleDef.role} label should be non-empty`,
				).not.toBe('');
			}
		}
	});

	it('each credential role has a non-empty envVarKey string', () => {
		for (const [provider, roles] of Object.entries(PROVIDER_CREDENTIAL_ROLES)) {
			for (const roleDef of roles) {
				expect(
					roleDef.envVarKey.trim(),
					`${provider}.${roleDef.role} envVarKey should be non-empty`,
				).not.toBe('');
			}
		}
	});

	it('has no duplicate envVarKey values across all providers', () => {
		const allEnvVarKeys: string[] = [];
		for (const roles of Object.values(PROVIDER_CREDENTIAL_ROLES)) {
			for (const roleDef of roles) {
				allEnvVarKeys.push(roleDef.envVarKey);
			}
		}
		const uniqueKeys = new Set(allEnvVarKeys);
		expect(uniqueKeys.size).toBe(allEnvVarKeys.length);
	});

	it('trello has api_key and token roles', () => {
		const roles = PROVIDER_CREDENTIAL_ROLES.trello.map((r) => r.role);
		expect(roles).toContain('api_key');
		expect(roles).toContain('token');
	});

	it('jira has email and api_token roles', () => {
		const roles = PROVIDER_CREDENTIAL_ROLES.jira.map((r) => r.role);
		expect(roles).toContain('email');
		expect(roles).toContain('api_token');
	});

	it('github has implementer_token and reviewer_token roles', () => {
		const roles = PROVIDER_CREDENTIAL_ROLES.github.map((r) => r.role);
		expect(roles).toContain('implementer_token');
		expect(roles).toContain('reviewer_token');
	});

	it('trello envVarKeys map to correct values', () => {
		const trelloByRole = Object.fromEntries(
			PROVIDER_CREDENTIAL_ROLES.trello.map((r) => [r.role, r]),
		);
		expect(trelloByRole.api_key.envVarKey).toBe('TRELLO_API_KEY');
		expect(trelloByRole.token.envVarKey).toBe('TRELLO_TOKEN');
	});

	it('github envVarKeys map to correct values', () => {
		const githubByRole = Object.fromEntries(
			PROVIDER_CREDENTIAL_ROLES.github.map((r) => [r.role, r]),
		);
		expect(githubByRole.implementer_token.envVarKey).toBe('GITHUB_TOKEN_IMPLEMENTER');
		expect(githubByRole.reviewer_token.envVarKey).toBe('GITHUB_TOKEN_REVIEWER');
	});
});

// ---------------------------------------------------------------------------
// registerCredentialRoles + getCredentialRoles
// ---------------------------------------------------------------------------

describe('registerCredentialRoles and getCredentialRoles', () => {
	// Clean up any providers registered during these tests so they don't
	// pollute other describe blocks that run in the same module context.
	afterEach(() => {
		// Re-register a clean slate by checking what was added; the simplest
		// approach is to call registerCredentialRoles with an empty array for
		// test-only provider names so PROVIDER_CREDENTIAL_ROLES iteration stays
		// stable. We use unique provider names to avoid collisions with defaults.
		registerCredentialRoles('test-provider-linear', 'pm', []);
		registerCredentialRoles('test-provider-clickup', 'pm', []);
	});

	it('registerCredentialRoles adds a new provider accessible via getCredentialRoles', () => {
		const roles = [{ role: 'api_token', label: 'API Token', envVarKey: 'LINEAR_API_TOKEN' }];
		registerCredentialRoles('test-provider-linear', 'pm', roles);

		const result = getCredentialRoles('test-provider-linear');
		expect(result).toEqual(roles);
	});

	it('getCredentialRoles returns roles for a newly registered provider', () => {
		const roles = [
			{ role: 'client_id', label: 'Client ID', envVarKey: 'CLICKUP_CLIENT_ID' },
			{ role: 'client_secret', label: 'Client Secret', envVarKey: 'CLICKUP_CLIENT_SECRET' },
		];
		registerCredentialRoles('test-provider-clickup', 'pm', roles);

		const result = getCredentialRoles('test-provider-clickup');
		expect(result).toHaveLength(2);
		expect(result[0].role).toBe('client_id');
		expect(result[1].role).toBe('client_secret');
	});

	it('getCredentialRoles returns empty array for unknown provider', () => {
		const result = getCredentialRoles('unknown-provider-xyz');
		expect(result).toEqual([]);
	});

	it('existing providers remain accessible via getCredentialRoles after registering a new one', () => {
		registerCredentialRoles('test-provider-linear', 'pm', [
			{ role: 'api_token', label: 'API Token', envVarKey: 'LINEAR_API_TOKEN' },
		]);

		// Existing default providers must still work
		const trelloRoles = getCredentialRoles('trello');
		expect(trelloRoles.map((r) => r.role)).toContain('api_key');

		const githubRoles = getCredentialRoles('github');
		expect(githubRoles.map((r) => r.role)).toContain('implementer_token');
	});

	it('PROVIDER_CREDENTIAL_ROLES proxy reflects newly registered provider', () => {
		const roles = [{ role: 'api_token', label: 'API Token', envVarKey: 'LINEAR_API_TOKEN' }];
		registerCredentialRoles('test-provider-linear', 'pm', roles);

		// Proxy get should return the roles
		const result = (PROVIDER_CREDENTIAL_ROLES as Record<string, typeof roles>)[
			'test-provider-linear'
		];
		expect(result).toEqual(roles);
	});

	it('PROVIDER_CATEGORY proxy reflects the category of a newly registered provider', () => {
		registerCredentialRoles('test-provider-linear', 'pm', [
			{ role: 'api_token', label: 'API Token', envVarKey: 'LINEAR_API_TOKEN' },
		]);

		const category = (PROVIDER_CATEGORY as Record<string, IntegrationCategory>)[
			'test-provider-linear'
		];
		expect(category).toBe('pm');
	});

	it('registerCredentialRoles overwrites roles when called again for the same provider', () => {
		const initialRoles = [{ role: 'old_token', label: 'Old Token', envVarKey: 'OLD_TOKEN' }];
		registerCredentialRoles('test-provider-linear', 'pm', initialRoles);

		const updatedRoles = [{ role: 'new_token', label: 'New Token', envVarKey: 'NEW_TOKEN' }];
		registerCredentialRoles('test-provider-linear', 'pm', updatedRoles);

		const result = getCredentialRoles('test-provider-linear');
		expect(result).toEqual(updatedRoles);
	});
});
