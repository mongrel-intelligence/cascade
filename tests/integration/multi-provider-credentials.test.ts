/**
 * Integration tests: Multi-Provider Credential Isolation
 *
 * Tests credential isolation across projects and integration categories
 * (PM vs SCM), dual-persona token resolution, and multi-project
 * cross-contamination checks. Core CRUD, single-project resolution,
 * resolveAll, resolveOrgCredential, and encryption round-trips are
 * covered in tests/integration/db/credentialsRepository.test.ts and
 * tests/integration/db/credentialResolution.test.ts.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { resolveIntegrationCredential } from '../../src/db/repositories/credentialsRepository.js';
import { truncateAll } from './helpers/db.js';
import {
	seedCredential,
	seedIntegration,
	seedIntegrationCredential,
	seedOrg,
	seedProject,
} from './helpers/seed.js';

describe('Multi-Provider Credential Isolation (integration)', () => {
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
