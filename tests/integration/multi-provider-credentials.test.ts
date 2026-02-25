/**
 * Integration tests: Multi-Integration Credential Resolution
 *
 * Tests credential isolation across providers: per-project isolation, dual-persona
 * token resolution, encryption round-trips, and edge cases.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	resolveAllIntegrationCredentials,
	resolveIntegrationCredential,
} from '../../src/db/repositories/credentialsRepository.js';
import { getPersonaForAgentType } from '../../src/github/personas.js';
import { truncateAll } from './helpers/db.js';
import {
	seedCredential,
	seedIntegration,
	seedIntegrationCredential,
	seedOrg,
	seedProject,
} from './helpers/seed.js';

describe('Multi-Provider Credential Resolution (integration)', () => {
	beforeEach(async () => {
		await truncateAll();
		await seedOrg();
		await seedProject();
	});

	// =========================================================================
	// Per-Project Credential Isolation
	// =========================================================================

	describe('per-project isolation', () => {
		it('resolves different credentials for different projects', async () => {
			// Set up two projects in the same org
			await seedProject({ id: 'project-a', name: 'Project A', repo: 'owner/repo-a' });
			await seedProject({ id: 'project-b', name: 'Project B', repo: 'owner/repo-b' });

			// Create separate credentials
			const credA = await seedCredential({
				orgId: 'test-org',
				name: 'Trello Key A',
				envVarKey: 'TRELLO_API_KEY',
				value: 'key-for-project-a',
			});
			const credB = await seedCredential({
				orgId: 'test-org',
				name: 'Trello Key B',
				envVarKey: 'TRELLO_API_KEY',
				value: 'key-for-project-b',
			});

			// Link credentials to project-specific integrations
			const integA = await seedIntegration({
				projectId: 'project-a',
				category: 'pm',
				provider: 'trello',
			});
			const integB = await seedIntegration({
				projectId: 'project-b',
				category: 'pm',
				provider: 'trello',
			});

			await seedIntegrationCredential({
				integrationId: integA.id,
				role: 'api_key',
				credentialId: credA.id,
			});
			await seedIntegrationCredential({
				integrationId: integB.id,
				role: 'api_key',
				credentialId: credB.id,
			});

			// Resolve credentials — they must be isolated per project
			const resolvedA = await resolveIntegrationCredential('project-a', 'pm', 'api_key');
			const resolvedB = await resolveIntegrationCredential('project-b', 'pm', 'api_key');

			expect(resolvedA).toBe('key-for-project-a');
			expect(resolvedB).toBe('key-for-project-b');
			expect(resolvedA).not.toBe(resolvedB);
		});

		it('returns null when project has no integration credential', async () => {
			// No integration seeded for 'test-project'
			const result = await resolveIntegrationCredential('test-project', 'pm', 'api_key');
			expect(result).toBeNull();
		});

		it('isolates PM credentials from SCM credentials on the same project', async () => {
			// A project can have one PM integration AND one SCM integration simultaneously
			const pmCred = await seedCredential({
				name: 'Trello Key',
				envVarKey: 'TRELLO_API_KEY',
				value: 'trello-api-key-value',
			});
			const scmCred = await seedCredential({
				name: 'GitHub Implementer',
				envVarKey: 'GITHUB_TOKEN_IMPLEMENTER',
				value: 'gh-impl-token-value',
			});

			const pmInteg = await seedIntegration({
				category: 'pm',
				provider: 'trello',
				config: { boardId: 'board-1', lists: {}, labels: {} },
			});
			const scmInteg = await seedIntegration({
				category: 'scm',
				provider: 'github',
				config: {},
			});

			await seedIntegrationCredential({
				integrationId: pmInteg.id,
				role: 'api_key',
				credentialId: pmCred.id,
			});
			await seedIntegrationCredential({
				integrationId: scmInteg.id,
				role: 'implementer_token',
				credentialId: scmCred.id,
			});

			const trelloKey = await resolveIntegrationCredential('test-project', 'pm', 'api_key');
			const ghToken = await resolveIntegrationCredential(
				'test-project',
				'scm',
				'implementer_token',
			);

			expect(trelloKey).toBe('trello-api-key-value');
			expect(ghToken).toBe('gh-impl-token-value');
		});
	});

	// =========================================================================
	// Dual-Persona (GitHub implementer vs reviewer)
	// =========================================================================

	describe('dual-persona GitHub credentials', () => {
		it('resolves implementer and reviewer tokens separately', async () => {
			const implCred = await seedCredential({
				name: 'Implementer Token',
				envVarKey: 'GITHUB_TOKEN_IMPLEMENTER',
				value: 'ghp-impl-token',
			});
			const reviewerCred = await seedCredential({
				name: 'Reviewer Token',
				envVarKey: 'GITHUB_TOKEN_REVIEWER',
				value: 'ghp-reviewer-token',
			});

			const scmInteg = await seedIntegration({
				category: 'scm',
				provider: 'github',
			});
			await seedIntegrationCredential({
				integrationId: scmInteg.id,
				role: 'implementer_token',
				credentialId: implCred.id,
			});
			await seedIntegrationCredential({
				integrationId: scmInteg.id,
				role: 'reviewer_token',
				credentialId: reviewerCred.id,
			});

			const implToken = await resolveIntegrationCredential(
				'test-project',
				'scm',
				'implementer_token',
			);
			const reviewerToken = await resolveIntegrationCredential(
				'test-project',
				'scm',
				'reviewer_token',
			);

			expect(implToken).toBe('ghp-impl-token');
			expect(reviewerToken).toBe('ghp-reviewer-token');
			expect(implToken).not.toBe(reviewerToken);
		});

		it('maps agent types to correct personas', () => {
			// Implementer agents
			expect(getPersonaForAgentType('implementation')).toBe('implementer');
			expect(getPersonaForAgentType('splitting')).toBe('implementer');
			expect(getPersonaForAgentType('planning')).toBe('implementer');
			expect(getPersonaForAgentType('respond-to-review')).toBe('implementer');
			expect(getPersonaForAgentType('respond-to-ci')).toBe('implementer');
			expect(getPersonaForAgentType('debug')).toBe('implementer');

			// Reviewer agent
			expect(getPersonaForAgentType('review')).toBe('reviewer');

			// Unknown agent defaults to implementer
			expect(getPersonaForAgentType('unknown-agent')).toBe('implementer');
		});
	});

	// =========================================================================
	// resolveAllIntegrationCredentials
	// =========================================================================

	describe('resolveAllIntegrationCredentials', () => {
		it('returns all credentials for a project across integrations', async () => {
			const trelloCred = await seedCredential({
				name: 'Trello Key',
				envVarKey: 'TRELLO_API_KEY',
				value: 'trello-key',
			});
			const trelloToken = await seedCredential({
				name: 'Trello Token',
				envVarKey: 'TRELLO_TOKEN',
				value: 'trello-token',
			});
			const ghImpl = await seedCredential({
				name: 'GH Impl',
				envVarKey: 'GITHUB_TOKEN_IMPLEMENTER',
				value: 'gh-impl',
			});

			const pmInteg = await seedIntegration({ category: 'pm', provider: 'trello' });
			const scmInteg = await seedIntegration({ category: 'scm', provider: 'github' });

			await seedIntegrationCredential({
				integrationId: pmInteg.id,
				role: 'api_key',
				credentialId: trelloCred.id,
			});
			await seedIntegrationCredential({
				integrationId: pmInteg.id,
				role: 'token',
				credentialId: trelloToken.id,
			});
			await seedIntegrationCredential({
				integrationId: scmInteg.id,
				role: 'implementer_token',
				credentialId: ghImpl.id,
			});

			const allCreds = await resolveAllIntegrationCredentials('test-project');

			expect(allCreds).toHaveLength(3);
			const apiKey = allCreds.find((c) => c.role === 'api_key');
			const token = allCreds.find((c) => c.role === 'token');
			const impl = allCreds.find((c) => c.role === 'implementer_token');

			expect(apiKey?.value).toBe('trello-key');
			expect(apiKey?.category).toBe('pm');
			expect(apiKey?.provider).toBe('trello');

			expect(token?.value).toBe('trello-token');
			expect(impl?.value).toBe('gh-impl');
			expect(impl?.category).toBe('scm');
		});

		it('returns empty array when project has no integration credentials', async () => {
			const allCreds = await resolveAllIntegrationCredentials('test-project');
			expect(allCreds).toHaveLength(0);
		});
	});

	// =========================================================================
	// Encryption Round-Trip
	// =========================================================================

	describe('encryption round-trip', () => {
		it('encrypts and decrypts integration credentials transparently', async () => {
			vi.stubEnv('CREDENTIAL_MASTER_KEY', 'a'.repeat(64));

			const { createCredential } = await import(
				'../../src/db/repositories/credentialsRepository.js'
			);

			const cred = await createCredential({
				orgId: 'test-org',
				name: 'Encrypted GitHub Token',
				envVarKey: 'GITHUB_TOKEN_IMPLEMENTER',
				value: 'plaintext-gh-token',
			});

			const integ = await seedIntegration({ category: 'scm', provider: 'github' });
			await seedIntegrationCredential({
				integrationId: integ.id,
				role: 'implementer_token',
				credentialId: cred.id,
			});

			// Should transparently decrypt
			const resolved = await resolveIntegrationCredential(
				'test-project',
				'scm',
				'implementer_token',
			);
			expect(resolved).toBe('plaintext-gh-token');
		});

		it('encrypts and decrypts org credentials transparently', async () => {
			vi.stubEnv('CREDENTIAL_MASTER_KEY', 'd'.repeat(64));

			const { createCredential } = await import(
				'../../src/db/repositories/credentialsRepository.js'
			);

			await createCredential({
				orgId: 'test-org',
				name: 'Encrypted LLM Key',
				envVarKey: 'OPENROUTER_API_KEY',
				value: 'plaintext-llm-key',
				isDefault: true,
			});

			const resolved = await resolveIntegrationCredential('test-project', 'pm', 'api_key');
			// Not linked to an integration, so should be null
			expect(resolved).toBeNull();

			// Resolve org credential directly
			const { resolveOrgCredential } = await import(
				'../../src/db/repositories/credentialsRepository.js'
			);
			const orgCred = await resolveOrgCredential('test-org', 'OPENROUTER_API_KEY');
			expect(orgCred).toBe('plaintext-llm-key');
		});
	});

	// =========================================================================
	// resolveIntegrationCredential (DB-direct wrapper)
	// Note: getIntegrationCredential (from config/provider) checks process.env first,
	// so we use the DB-direct function to test credential resolution cleanly.
	// =========================================================================

	describe('resolveIntegrationCredential (DB-direct)', () => {
		it('returns credential value via DB lookup', async () => {
			const cred = await seedCredential({
				name: 'Custom GitHub Key',
				// Use a non-standard key that won't match env vars
				envVarKey: 'CUSTOM_GITHUB_TOKEN_XYZ',
				value: 'db-resolved-token',
			});

			const integ = await seedIntegration({ category: 'scm', provider: 'github' });
			await seedIntegrationCredential({
				integrationId: integ.id,
				role: 'implementer_token',
				credentialId: cred.id,
			});

			const value = await resolveIntegrationCredential('test-project', 'scm', 'implementer_token');
			expect(value).toBe('db-resolved-token');
		});

		it('returns null when integration credential is missing', async () => {
			// No integration seeded for this role
			const value = await resolveIntegrationCredential('test-project', 'pm', 'nonexistent_role');
			expect(value).toBeNull();
		});
	});

	// =========================================================================
	// resolveOrgCredential (DB-direct, avoids env var priority)
	// =========================================================================

	describe('resolveOrgCredential (DB-direct)', () => {
		it('returns null when org credential not found', async () => {
			const { resolveOrgCredential } = await import(
				'../../src/db/repositories/credentialsRepository.js'
			);
			const value = await resolveOrgCredential('test-org', 'SOME_KEY_NOT_IN_DB_AT_ALL');
			expect(value).toBeNull();
		});

		it('returns credential value when org default exists', async () => {
			const { resolveOrgCredential } = await import(
				'../../src/db/repositories/credentialsRepository.js'
			);
			// Use a unique key that won't collide with env vars in the test environment
			await seedCredential({
				orgId: 'test-org',
				name: 'Custom Test Key',
				envVarKey: 'MY_UNIQUE_CUSTOM_TEST_KEY_XYZ',
				value: 'custom-test-value',
				isDefault: true,
			});

			const value = await resolveOrgCredential('test-org', 'MY_UNIQUE_CUSTOM_TEST_KEY_XYZ');
			expect(value).toBe('custom-test-value');
		});
	});

	// =========================================================================
	// Multi-project credential isolation (3 projects)
	// =========================================================================

	describe('3-project org credential isolation', () => {
		it('each project gets its own credentials with no cross-contamination', async () => {
			// Seed 3 projects
			await seedProject({ id: 'proj-1', name: 'Project 1', repo: 'owner/repo-1' });
			await seedProject({ id: 'proj-2', name: 'Project 2', repo: 'owner/repo-2' });
			await seedProject({ id: 'proj-3', name: 'Project 3', repo: 'owner/repo-3' });

			// Create distinct GitHub tokens for each
			const tokens = ['ghp-token-proj-1', 'ghp-token-proj-2', 'ghp-token-proj-3'];
			const projectIds = ['proj-1', 'proj-2', 'proj-3'];

			for (let i = 0; i < 3; i++) {
				const cred = await seedCredential({
					orgId: 'test-org',
					name: `GH Token ${i + 1}`,
					envVarKey: 'GITHUB_TOKEN_IMPLEMENTER',
					value: tokens[i],
				});
				const integ = await seedIntegration({
					projectId: projectIds[i],
					category: 'scm',
					provider: 'github',
				});
				await seedIntegrationCredential({
					integrationId: integ.id,
					role: 'implementer_token',
					credentialId: cred.id,
				});
			}

			// Verify each project resolves its own token
			for (let i = 0; i < 3; i++) {
				const resolved = await resolveIntegrationCredential(
					projectIds[i],
					'scm',
					'implementer_token',
				);
				expect(resolved).toBe(tokens[i]);
			}
		});
	});
});
