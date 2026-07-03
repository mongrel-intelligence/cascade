import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { projects } from '../../../../src/db/schema/projects.js';

/**
 * Spec 023 plan 1/5 — per-project worker Dockerfile (dormant).
 *
 * Pins the three nullable text columns added by migration 0059, their journal
 * entry, and the Drizzle exposure with snake_case SQL names. The columns ship
 * dormant (nothing builds/resolves/launches against them yet); this test keeps
 * the migration, journal, drizzle schema, configMapper, and repository in
 * lockstep so the plumbing lands reviewable in isolation.
 */

const ROOT = path.resolve(import.meta.dirname, '../../../..');

function readRoot(rel: string): string {
	return readFileSync(path.join(ROOT, rel), 'utf-8');
}

const NEW_COLUMNS = [
	'worker_dockerfile',
	'worker_image_build_hash',
	'worker_image_build_status',
] as const;

describe('projects schema — worker-dockerfile columns', () => {
	it('drizzle exposes the three columns with snake_case names', () => {
		expect(projects.workerDockerfile.name).toBe('worker_dockerfile');
		expect(projects.workerImageBuildHash.name).toBe('worker_image_build_hash');
		expect(projects.workerImageBuildStatus.name).toBe('worker_image_build_status');
	});

	it('all three columns are nullable (no NOT NULL constraint)', () => {
		expect(projects.workerDockerfile.notNull).toBe(false);
		expect(projects.workerImageBuildHash.notNull).toBe(false);
		expect(projects.workerImageBuildStatus.notNull).toBe(false);
	});
});

describe('migration 0059_project_worker_dockerfile', () => {
	const sql = readRoot('src/db/migrations/0059_project_worker_dockerfile.sql');

	it('adds each column as a nullable text column', () => {
		for (const col of NEW_COLUMNS) {
			expect(sql).toContain(`ALTER TABLE projects ADD COLUMN ${col} text;`);
		}
	});

	it('does not mark any new column NOT NULL', () => {
		expect(sql.toLowerCase()).not.toContain('not null');
	});

	it('documents the derived-source rule and the build-status split', () => {
		expect(sql).toMatch(/derived/i);
		expect(sql).toMatch(/worker_image_build_status/);
		expect(sql).toMatch(/worker_image_digest/);
	});
});

describe('migration journal — 0059 entry', () => {
	const journal = JSON.parse(readRoot('src/db/migrations/meta/_journal.json')) as {
		entries: Array<{ idx: number; tag: string; when: number }>;
	};

	it('registers idx 59 with the expected tag', () => {
		const entry = journal.entries.find((e) => e.idx === 59);
		expect(entry).toBeDefined();
		expect(entry?.tag).toBe('0059_project_worker_dockerfile');
	});

	it('uses a `when` strictly greater than the 0058 entry', () => {
		const prev = journal.entries.find((e) => e.idx === 58);
		const curr = journal.entries.find((e) => e.idx === 59);
		expect(prev?.when).toBeDefined();
		expect(curr?.when).toBeDefined();
		expect(curr?.when ?? 0).toBeGreaterThan(prev?.when ?? 0);
	});
});
