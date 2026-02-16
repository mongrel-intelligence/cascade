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

		// Check if a global config row already exists for this agent type
		const [existing] = await db
			.select({ id: agentConfigs.id })
			.from(agentConfigs)
			.where(
				and(
					eq(agentConfigs.agentType, agentType),
					isNull(agentConfigs.projectId),
					isNull(agentConfigs.orgId),
				),
			);

		if (existing) {
			await db
				.update(agentConfigs)
				.set({ prompt: content, updatedAt: new Date() })
				.where(eq(agentConfigs.id, existing.id));
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
