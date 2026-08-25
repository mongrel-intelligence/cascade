/**
 * Spec 024 plan 1 — schema shape + payload-aware project lookups.
 *
 * The schema assertions here pin the topology migration's drizzle side: the
 * `repo_primary` column exists, and `repo` no longer carries a column-level
 * unique (uniqueness moved to the partial index `uq_projects_repo_primary`,
 * which only constrains primary rows so siblings can share a repository).
 */
import { describe, expect, it } from 'vitest';
import { projects } from '../../../src/db/schema/projects.js';

// Drizzle's column objects expose `notNull` / `hasDefault` / `default` /
// `isUnique` directly; casting keeps the assertions readable without pulling
// drizzle's internal column generics into the test.
const cols = projects as unknown as Record<string, Record<string, unknown>>;

describe('projects schema — topology columns', () => {
	it('exposes repoPrimary as a NOT NULL boolean defaulting to true', () => {
		const repoPrimary = cols.repoPrimary;
		expect(repoPrimary).toBeDefined();
		expect(repoPrimary.name).toBe('repo_primary');
		expect(repoPrimary.notNull).toBe(true);
		expect(repoPrimary.hasDefault).toBe(true);
		expect(repoPrimary.default).toBe(true);
	});

	it('no longer declares a column-level unique on repo', () => {
		// Uniqueness is now the partial index uq_projects_repo_primary
		// (WHERE repo IS NOT NULL AND repo_primary), so two projects may share
		// a repository as long as exactly one of them is primary.
		expect(cols.repo.isUnique).not.toBe(true);
	});
});
