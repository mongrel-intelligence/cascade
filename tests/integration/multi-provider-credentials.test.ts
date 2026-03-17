/**
 * Integration tests: Multi-Provider Credential Isolation
 *
 * Tests credential isolation across projects (per project_credentials table).
 * Each project has its own credentials — no cross-contamination.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
	resolveProjectCredential,
	writeProjectCredential,
} from '../../src/db/repositories/credentialsRepository.js';
import { truncateAll } from './helpers/db.js';
import { seedOrg, seedProject } from './helpers/seed.js';

beforeAll(async () => {
	await truncateAll();
});

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

			// Write separate credentials to each project
			await writeProjectCredential(
				'project-a',
				'TRELLO_API_KEY',
				'key-for-project-a',
				'Trello Key A',
			);
			await writeProjectCredential(
				'project-b',
				'TRELLO_API_KEY',
				'key-for-project-b',
				'Trello Key B',
			);

			// Resolve credentials — they must be isolated per project
			const resolvedA = await resolveProjectCredential('project-a', 'TRELLO_API_KEY');
			const resolvedB = await resolveProjectCredential('project-b', 'TRELLO_API_KEY');

			expect(resolvedA).toBe('key-for-project-a');
			expect(resolvedB).toBe('key-for-project-b');
			expect(resolvedA).not.toBe(resolvedB);
		});

		it('resolves different credential types from same project', async () => {
			// Write PM and SCM credentials directly to project_credentials
			await writeProjectCredential(
				'test-project',
				'TRELLO_API_KEY',
				'trello-api-key-value',
				'Trello Key',
			);
			await writeProjectCredential(
				'test-project',
				'GITHUB_TOKEN_IMPLEMENTER',
				'gh-impl-token-value',
				'GitHub Implementer',
			);

			const trelloKey = await resolveProjectCredential('test-project', 'TRELLO_API_KEY');
			const ghToken = await resolveProjectCredential('test-project', 'GITHUB_TOKEN_IMPLEMENTER');

			expect(trelloKey).toBe('trello-api-key-value');
			expect(ghToken).toBe('gh-impl-token-value');
		});
	});

	// =========================================================================
	// Dual-Persona (GitHub implementer vs reviewer)
	// =========================================================================

	describe('dual-persona GitHub credentials', () => {
		it('resolves implementer and reviewer tokens separately', async () => {
			await writeProjectCredential(
				'test-project',
				'GITHUB_TOKEN_IMPLEMENTER',
				'ghp-impl-token',
				'Implementer Token',
			);
			await writeProjectCredential(
				'test-project',
				'GITHUB_TOKEN_REVIEWER',
				'ghp-reviewer-token',
				'Reviewer Token',
			);

			const implToken = await resolveProjectCredential('test-project', 'GITHUB_TOKEN_IMPLEMENTER');
			const reviewerToken = await resolveProjectCredential('test-project', 'GITHUB_TOKEN_REVIEWER');

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

			// Write distinct GitHub tokens for each project
			const tokens = ['ghp-token-proj-1', 'ghp-token-proj-2', 'ghp-token-proj-3'];
			const projectIds = ['proj-1', 'proj-2', 'proj-3'];

			for (let i = 0; i < 3; i++) {
				await writeProjectCredential(
					projectIds[i],
					'GITHUB_TOKEN_IMPLEMENTER',
					tokens[i],
					`GH Token ${i + 1}`,
				);
			}

			// Verify each project resolves its own token
			for (let i = 0; i < 3; i++) {
				const resolved = await resolveProjectCredential(projectIds[i], 'GITHUB_TOKEN_IMPLEMENTER');
				expect(resolved).toBe(tokens[i]);
			}
		});
	});
});
