import { describe, expect, it } from 'vitest';

import {
	type IntegrationCategory,
	type IntegrationProvider,
	PROVIDER_CATEGORY,
	PROVIDER_CREDENTIAL_ROLES,
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
		const validCategories: IntegrationCategory[] = ['pm', 'scm'];
		for (const [provider, category] of Object.entries(PROVIDER_CATEGORY)) {
			expect(validCategories).toContain(category);
		}
	});

	it('contains all expected providers', () => {
		const expectedProviders: IntegrationProvider[] = ['trello', 'jira', 'github'];
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
