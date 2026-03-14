#!/usr/bin/env tsx
/**
 * Seed database with prompt partials from disk .eta files.
 *
 * Reads all partials from src/agents/prompts/templates/partials/ and inserts
 * them as prompt_partials rows.
 *
 * Note: Agent prompt templates are now managed via Agent Definitions
 * (agent_definitions table), not agent_configs.
 *
 * Uses upsert semantics — safe to re-run.
 *
 * Usage:
 *   npx tsx tools/seed-prompts.ts
 *
 * Requires DATABASE_URL to be set.
 */

import { getAvailablePartialNames, getRawPartial } from '../src/agents/prompts/index.js';
import { closeDb } from '../src/db/client.js';
import { upsertPartial } from '../src/db/repositories/partialsRepository.js';

async function seedPartials() {
	const partialNames = getAvailablePartialNames();

	console.log(`Seeding ${partialNames.length} prompt partials...`);

	for (const name of partialNames) {
		const content = getRawPartial(name);
		await upsertPartial({ name, content });
		console.log(`  Upserted: ${name}`);
	}
}

async function main() {
	try {
		await seedPartials();
		console.log('\nDone.');
	} catch (err) {
		console.error('Error seeding prompts:', err);
		process.exit(1);
	} finally {
		await closeDb();
	}
}

main();
