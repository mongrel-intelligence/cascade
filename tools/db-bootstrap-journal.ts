#!/usr/bin/env tsx
/**
 * Bootstrap the drizzle migration journal in the database.
 *
 * This script reads the local migration journal (meta/_journal.json) and
 * inserts rows into drizzle.__drizzle_migrations for any migrations that
 * are not yet tracked. This is needed when a database was initially set up
 * with `drizzle-kit push` (no journal) and later switched to `drizzle-kit migrate`.
 *
 * Safe to run multiple times — only inserts migrations with timestamps newer
 * than the latest tracked migration.
 *
 * Usage:
 *   npx tsx tools/db-bootstrap-journal.ts
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { closeDb, getDb } from '../src/db/client.js';

interface JournalEntry {
	idx: number;
	version: string;
	when: number;
	tag: string;
	breakpoints: boolean;
}

interface Journal {
	version: string;
	dialect: string;
	entries: JournalEntry[];
}

const MIGRATIONS_DIR = 'src/db/migrations';

async function main() {
	const db = getDb();

	// Ensure schema and table exist
	await db.execute(sql`CREATE SCHEMA IF NOT EXISTS drizzle`);
	await db.execute(sql`
		CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
			id SERIAL PRIMARY KEY,
			hash text NOT NULL,
			created_at bigint
		)
	`);

	// Read current DB state
	const dbRows = await db.execute(
		sql`SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1`,
	);
	const lastApplied = dbRows.rows[0] as { created_at: string } | undefined;
	const lastTimestamp = lastApplied ? Number(lastApplied.created_at) : 0;
	console.log(`Last tracked migration timestamp: ${lastTimestamp || '(none)'}`);

	// Read journal
	const journalPath = `${MIGRATIONS_DIR}/meta/_journal.json`;
	const journal: Journal = JSON.parse(readFileSync(journalPath, 'utf-8'));
	console.log(`Journal has ${journal.entries.length} entries`);

	// Insert missing entries
	let inserted = 0;
	for (const entry of journal.entries) {
		if (entry.when <= lastTimestamp) {
			console.log(`  skip: ${entry.tag} (already tracked)`);
			continue;
		}

		const sqlContent = readFileSync(`${MIGRATIONS_DIR}/${entry.tag}.sql`, 'utf-8');
		const hash = createHash('sha256').update(sqlContent).digest('hex');

		await db.execute(
			sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${hash}, ${entry.when})`,
		);
		console.log(`  inserted: ${entry.tag} (hash=${hash.slice(0, 12)}..., when=${entry.when})`);
		inserted++;
	}

	console.log(`\nDone. Inserted ${inserted} migration(s).`);
	await closeDb();
}

main().catch((err) => {
	console.error('Error:', err);
	process.exit(1);
});
