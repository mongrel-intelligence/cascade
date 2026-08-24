/**
 * Spec 024 plan 1 — migration 0061 semantics, against a real Postgres.
 *
 * The unit suite asserts the drizzle schema *shape*; it never touches a
 * database, so it cannot catch a wrong WHERE clause on the partial index, a
 * surviving old constraint, or a lost rejection. This is the only non-dormant
 * artifact the plan ships, and these are the assertions that keep AC #12's
 * database half true after anyone edits the migration.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../../src/db/client.js';
import { findRepoSiblingsFromDb } from '../../../src/db/repositories/configRepository.js';
import { createProject } from '../../../src/db/repositories/projectsRepository.js';
import { projects } from '../../../src/db/schema/index.js';
import { truncateAll } from '../helpers/db.js';
import { seedOrg } from '../helpers/seed.js';

const project = (id: string, repo: string | null, repoPrimary = true) => ({
	id,
	orgId: 'test-org',
	name: id,
	repo,
	repoPrimary,
});

describe('projects repo topology (integration)', () => {
	beforeEach(async () => {
		await truncateAll();
		await seedOrg();
	});

	it('defaults repo_primary to true so existing rows become their repo primary', async () => {
		const db = getDb();
		const [row] = await db
			.insert(projects)
			.values({ id: 'p1', orgId: 'test-org', name: 'P1', repo: 'acme/web' })
			.returning();

		expect(row.repoPrimary).toBe(true);
	});

	it('accepts a primary and a secondary project on the same repository', async () => {
		// The save that was impossible before 024 — it surfaced to operators as a
		// generic 500 from an unhandled uniqueness violation.
		const db = getDb();
		await db.insert(projects).values(project('p1', 'acme/web', true));
		await db.insert(projects).values(project('p2', 'acme/web', false));

		const rows = await db.select().from(projects);
		expect(rows).toHaveLength(2);
	});

	it('rejects a second primary on the same repository', async () => {
		const db = getDb();
		await db.insert(projects).values(project('p1', 'acme/web', true));

		await expect(db.insert(projects).values(project('p2', 'acme/web', true))).rejects.toMatchObject(
			{ cause: { code: '23505' } },
		);
	});

	it('still rejects two default-primary projects on one repository (AC #12)', async () => {
		// Every pre-024 caller inserts without naming repo_primary. Those inserts
		// must keep colliding exactly as they did under the old plain UNIQUE.
		const db = getDb();
		await db.insert(projects).values({ id: 'p1', orgId: 'test-org', name: 'P1', repo: 'acme/web' });

		await expect(
			db.insert(projects).values({ id: 'p2', orgId: 'test-org', name: 'P2', repo: 'acme/web' }),
		).rejects.toMatchObject({ cause: { code: '23505' } });
	});

	it('allows many projects with no repository at all', async () => {
		// The partial index is scoped WHERE repo IS NOT NULL; PM-only projects
		// must not collide with each other on a NULL repo.
		const db = getDb();
		await db.insert(projects).values(project('p1', null));
		await db.insert(projects).values(project('p2', null));

		const rows = await db.select().from(projects);
		expect(rows).toHaveLength(2);
	});

	it('persists repoPrimary through createProject', async () => {
		// createProject builds an explicit column whitelist, so a column missing
		// from it is silently dropped and the schema default applies. Asserting
		// the router's argument to a MOCKED createProject cannot see that — only
		// a real INSERT can. Without this, saving a secondary is impossible: the
		// row defaults to primary and dies on uq_projects_repo_primary.
		await createProject('test-org', { id: 'p1', name: 'P1', repo: 'acme/web' });
		await createProject('test-org', {
			id: 'p2',
			name: 'P2',
			repo: 'acme/web',
			repoPrimary: false,
		});

		const rows = await getDb().select().from(projects);
		expect(rows.find((r) => r.id === 'p1')?.repoPrimary).toBe(true);
		expect(rows.find((r) => r.id === 'p2')?.repoPrimary).toBe(false);
	});

	it('returns only the calling organization’s projects on a repository', async () => {
		// Sibling ids are rendered verbatim into operator-facing save errors, so
		// an unscoped query names another tenant's project. Asserting the router
		// passed the right arguments cannot see that — only running the query can.
		// It also catches the worse failure: a query that matches nothing returns
		// [] for every input, which reports "no siblings" for every duplicate save
		// and silently disables this plan's entire pre-check.
		await seedOrg('other-org', 'Other Org');
		const db = getDb();
		await db.insert(projects).values(project('mine', 'acme/web', true));
		await db.insert(projects).values({
			id: 'theirs',
			orgId: 'other-org',
			name: 'Theirs',
			repo: 'acme/web',
			// Secondary: uq_projects_repo_primary is global on `repo`, not
			// org-scoped, so another org cannot hold a second PRIMARY on the same
			// repository. That constraint is what keeps cross-tenant repo
			// ownership impossible; this test is about the query's scoping.
			repoPrimary: false,
		});

		const siblings = await findRepoSiblingsFromDb('acme/web', 'test-org');

		expect(siblings).toEqual([{ id: 'mine', repoPrimary: true }]);
	});

	it('returns every project the calling organization has on a repository', async () => {
		const db = getDb();
		await db.insert(projects).values(project('primary', 'acme/web', true));
		await db.insert(projects).values(project('secondary', 'acme/web', false));

		const siblings = await findRepoSiblingsFromDb('acme/web', 'test-org');

		// Ordered by id so operator-facing messages are stable.
		expect(siblings).toEqual([
			{ id: 'primary', repoPrimary: true },
			{ id: 'secondary', repoPrimary: false },
		]);
	});

	it('drops the table-level unique constraint left by `drizzle-kit push`', async () => {
		// This harness migrates from the journal, where 0019 created an INDEX and
		// never a table-level constraint — so simply asserting the constraint is
		// absent after migrating proves nothing at all. Reproduce the
		// push-bootstrapped shape explicitly and run 0061's own DROP statement
		// against it; that is the only way to exercise the line, and it fails if
		// anyone deletes it from the migration.
		const db = getDb();
		const migration = readFileSync(
			new URL('../../../src/db/migrations/0061_repo_primary_topology.sql', import.meta.url),
			'utf8',
		);
		const dropConstraint = migration
			.split('\n')
			.find((line) => line.startsWith('ALTER TABLE "projects" DROP CONSTRAINT'));
		expect(dropConstraint, '0061 must keep its DROP CONSTRAINT line').toBeDefined();

		try {
			await db.execute(
				`ALTER TABLE "projects" ADD CONSTRAINT "projects_repo_unique" UNIQUE ("repo")`,
			);
			await db.insert(projects).values(project('p1', 'acme/web', true));

			// Sanity: with the pushed constraint in place, sharing is impossible.
			await expect(
				db.insert(projects).values(project('p2', 'acme/web', false)),
			).rejects.toMatchObject({ cause: { code: '23505' } });

			await db.execute(dropConstraint as string);

			await db.insert(projects).values(project('p2', 'acme/web', false));
			expect(await db.select().from(projects)).toHaveLength(2);
		} finally {
			await db.execute(`ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_repo_unique"`);
		}
	});
});
