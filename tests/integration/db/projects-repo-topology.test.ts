/**
 * Spec 024 plan 1 — migration 0061 semantics, against a real Postgres.
 *
 * The unit suite asserts the drizzle schema *shape*; it never touches a
 * database, so it cannot catch a wrong WHERE clause on the partial index, a
 * surviving old constraint, or a lost rejection. This is the only non-dormant
 * artifact the plan ships, and these are the assertions that keep AC #12's
 * database half true after anyone edits the migration.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../../src/db/client.js';
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

	it('leaves no table-level unique constraint on repo', async () => {
		// `drizzle-kit push`-bootstrapped deployments carried a generated
		// table-level constraint that DROP INDEX would not remove; 0061 drops it
		// explicitly. If it survived, shared repositories would stay impossible.
		const db = getDb();
		const result = await db.execute(
			`SELECT conname FROM pg_constraint c
			 JOIN pg_class t ON t.oid = c.conrelid
			 WHERE t.relname = 'projects' AND c.contype = 'u'`,
		);
		const rows = (result as unknown as { rows: unknown[] }).rows ?? result;
		expect(rows).toHaveLength(0);
	});
});
