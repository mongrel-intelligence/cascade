#!/usr/bin/env tsx
/**
 * Seed database with prompt templates and partials from disk .eta files.
 *
 * Reads all .eta templates from src/agents/prompts/templates/ and inserts them
 * as global agent_configs rows (prompt column). Reads all partials from
 * src/agents/prompts/templates/partials/ and inserts them as prompt_partials rows.
 *
 * Uses upsert semantics — safe to re-run.
 *
 * Usage:
 *   npx tsx tools/seed-prompts.ts
 *
 * Requires DATABASE_URL to be set.
 */

import { and, eq, isNull } from 'drizzle-orm';
import {
	getAvailablePartialNames,
	getRawPartial,
	getRawTemplate,
	getValidAgentTypes,
} from '../src/agents/prompts/index.js';
import { closeDb, getDb } from '../src/db/client.js';
import { upsertPartial } from '../src/db/repositories/partialsRepository.js';
import { agentConfigs } from '../src/db/schema/index.js';

async function seedTemplates() {
	const db = getDb();
	const agentTypes = getValidAgentTypes();

	console.log(`Seeding ${agentTypes.length} agent prompt templates...`);

	for (const agentType of agentTypes) {
		const content = getRawTemplate(agentType);

		// Update-first approach: try updating existing non-project row, insert if none affected.
		// The unique constraint uq_agent_configs_global is on (agent_type) WHERE project_id IS NULL,
		// so we match any row with this agent_type and no project (regardless of org_id).
		const updated = await db
			.update(agentConfigs)
			.set({ prompt: content, updatedAt: new Date() })
			.where(and(eq(agentConfigs.agentType, agentType), isNull(agentConfigs.projectId)))
			.returning({ id: agentConfigs.id });

		if (updated.length > 0) {
			console.log(`  Updated: ${agentType}`);
		} else {
			await db.insert(agentConfigs).values({
				agentType,
				prompt: content,
			});
			console.log(`  Created: ${agentType}`);
		}
	}
}

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
		await seedTemplates();
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
