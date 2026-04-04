/**
 * Seed script: reads all 10 YAML agent definition files and upserts them into
 * the `agent_definitions` table with `isBuiltin: true`.
 *
 * This script is idempotent — running it multiple times produces the same result.
 *
 * Usage:
 *   npx tsx src/db/seeds/seedAgentDefinitions.ts
 */

import { getBuiltinAgentTypes, loadBuiltinDefinition } from '../../agents/definitions/loader.js';
import { readTemplateFileSync } from '../../agents/prompts/index.js';
import { upsertAgentDefinition } from '../repositories/agentDefinitionsRepository.js';

export async function seedAgentDefinitions(): Promise<void> {
	const agentTypes = getBuiltinAgentTypes();

	console.log(`Seeding ${agentTypes.length} agent definitions...`);

	for (const agentType of agentTypes) {
		const definition = loadBuiltinDefinition(agentType);
		const systemPrompt = readTemplateFileSync(agentType);
		const enriched = systemPrompt
			? { ...definition, prompts: { ...definition.prompts, systemPrompt } }
			: definition;
		await upsertAgentDefinition(agentType, enriched, /* isBuiltin */ true);
		console.log(`  ✓ ${agentType}`);
	}

	console.log('Done.');
}

// Allow running directly
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
	import('../../db/client.js').then(({ closeDb }) => {
		seedAgentDefinitions()
			.then(() => closeDb())
			.then(() => process.exit(0))
			.catch((err) => {
				console.error(err);
				process.exit(1);
			});
	});
}
