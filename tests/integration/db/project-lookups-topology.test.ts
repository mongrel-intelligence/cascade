/**
 * Spec 024 plan 1 — the new project-lookup queries, against a real Postgres.
 *
 * The unit suite for these lookups mocks the repository layer, so it proves the
 * cache/delegate wiring but never executes a single line of SQL. That leaves the
 * queries themselves — the part where an ORDER BY or a WHERE clause is silently
 * wrong — untested. `findProjectIdByRepoPrFromDb`'s NULLS LAST ordering in
 * particular was verified only by inspecting the emitted SQL string, which
 * proves the text and not the behaviour; the ordering test below is written to
 * fail if the clause regresses to a plain DESC.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../../src/db/client.js';
import {
	findPrimaryProjectByRepoFromDb,
	findProjectsByJiraProjectKeyFromDb,
} from '../../../src/db/repositories/configRepository.js';
import { findProjectIdByRepoPrFromDb } from '../../../src/db/repositories/prWorkItemsRepository.js';
import { projects, prWorkItems } from '../../../src/db/schema/index.js';
import { truncateAll } from '../helpers/db.js';
import { seedIntegration, seedOrg } from '../helpers/seed.js';

const REPO = 'acme/web';

const insertProject = (id: string, repo: string | null, repoPrimary = true) =>
	getDb().insert(projects).values({ id, orgId: 'test-org', name: id, repo, repoPrimary });

const link = (projectId: string, prNumber: number, over: Record<string, unknown> = {}) =>
	getDb()
		.insert(prWorkItems)
		.values({ projectId, repoFullName: REPO, prNumber, ...over });

describe('project lookups for shared topologies (integration)', () => {
	beforeEach(async () => {
		await truncateAll();
		await seedOrg();
	});

	describe('findProjectIdByRepoPrFromDb', () => {
		it('resolves a PR to the project that linked it', async () => {
			await insertProject('p1', REPO);
			await link('p1', 42);

			expect(await findProjectIdByRepoPrFromDb(REPO, 42)).toBe('p1');
		});

		it('returns null for a PR nothing has linked', async () => {
			await insertProject('p1', REPO);
			await link('p1', 42);

			// The caller's cue to fall back to the repository's primary project.
			expect(await findProjectIdByRepoPrFromDb(REPO, 99)).toBeNull();
		});

		it('does not leak a link across repositories', async () => {
			await insertProject('p1', REPO);
			await link('p1', 42);

			expect(await findProjectIdByRepoPrFromDb('other/repo', 42)).toBeNull();
		});

		it('prefers the freshly updated link over one that was never updated', async () => {
			// Two projects sharing a repo may each hold a row for the same PR:
			// uq_pr_work_items_project_pr is unique per PROJECT, not per repo.
			// `updated_at` is nullable and was never backfilled (migration 0029),
			// and Postgres sorts DESC as NULLS FIRST — so without an explicit
			// NULLS LAST the never-updated row wins and the stalest link routes
			// the event. Asserting p2 here is what makes that regression fail.
			await insertProject('p1', REPO, true);
			await insertProject('p2', REPO, false);
			await link('p1', 42, { updatedAt: null, createdAt: new Date('2026-01-01T00:00:00Z') });
			await link('p2', 42, {
				updatedAt: new Date('2026-06-01T00:00:00Z'),
				createdAt: new Date('2026-05-01T00:00:00Z'),
			});

			expect(await findProjectIdByRepoPrFromDb(REPO, 42)).toBe('p2');
		});

		it('falls back to created_at when neither link was ever updated', async () => {
			await insertProject('p1', REPO, true);
			await insertProject('p2', REPO, false);
			await link('p1', 42, { updatedAt: null, createdAt: new Date('2026-01-01T00:00:00Z') });
			await link('p2', 42, { updatedAt: null, createdAt: new Date('2026-07-01T00:00:00Z') });

			expect(await findProjectIdByRepoPrFromDb(REPO, 42)).toBe('p2');
		});
	});

	describe('findPrimaryProjectByRepoFromDb', () => {
		it('returns the primary project, never the secondary', async () => {
			await insertProject('secondary', REPO, false);
			await insertProject('primary', REPO, true);

			const found = await findPrimaryProjectByRepoFromDb(REPO);
			expect(found?.id).toBe('primary');
		});

		it('returns undefined when a repository has only secondaries', async () => {
			// Reachable while an operator is mid-reconfiguration; the caller must
			// treat it as "no owner for unlinked events" rather than pick one.
			await insertProject('secondary', REPO, false);

			expect(await findPrimaryProjectByRepoFromDb(REPO)).toBeUndefined();
		});
	});

	describe('findProjectsByJiraProjectKeyFromDb', () => {
		const jira = (projectId: string, projectKey: string) =>
			seedIntegration({
				projectId,
				category: 'pm',
				provider: 'jira',
				config: { baseUrl: 'https://test.atlassian.net', projectKey, statuses: {} },
			});

		it('returns every project sharing a key, ordered by id', async () => {
			// Inserted out of order: the ordering must come from the query, since
			// this list surfaces verbatim in operator-facing skip messages.
			await insertProject('proj-b', 'acme/backend');
			await insertProject('proj-a', 'acme/frontend');
			await jira('proj-b', 'SHARED');
			await jira('proj-a', 'SHARED');

			const found = await findProjectsByJiraProjectKeyFromDb('SHARED');
			expect(found.map((p) => p.id)).toEqual(['proj-a', 'proj-b']);
		});

		it('excludes projects on a different key', async () => {
			await insertProject('mine', 'acme/frontend');
			await insertProject('theirs', 'acme/backend');
			await jira('mine', 'SHARED');
			await jira('theirs', 'OTHER');

			const found = await findProjectsByJiraProjectKeyFromDb('SHARED');
			expect(found.map((p) => p.id)).toEqual(['mine']);
		});

		it('returns an empty array for an unknown key', async () => {
			await insertProject('mine', 'acme/frontend');
			await jira('mine', 'SHARED');

			expect(await findProjectsByJiraProjectKeyFromDb('NOPE')).toEqual([]);
		});
	});
});
