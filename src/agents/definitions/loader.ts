import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { type AgentDefinition, AgentDefinitionSchema } from './schema.js';

// ============================================================================
// YAML Loader
// ============================================================================

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Cache of parsed + validated agent definitions */
const cache = new Map<string, AgentDefinition>();

/** Lazily discovered set of agent types (from YAML filenames) */
let knownTypes: string[] | null = null;

/**
 * Load and validate a single agent definition from YAML.
 * Results are cached after first load.
 */
export function loadAgentDefinition(agentType: string): AgentDefinition {
	const cached = cache.get(agentType);
	if (cached) return cached;

	const filePath = join(__dirname, `${agentType}.yaml`);
	let raw: string;
	try {
		raw = readFileSync(filePath, 'utf-8');
	} catch {
		throw new Error(`Agent definition not found: ${agentType}.yaml (looked in ${__dirname})`);
	}

	const parsed = yaml.load(raw);
	const result = AgentDefinitionSchema.safeParse(parsed);
	if (!result.success) {
		const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
		throw new Error(`Invalid agent definition '${agentType}.yaml':\n${issues}`);
	}

	cache.set(agentType, result.data);
	return result.data;
}

/**
 * Load all agent definitions discovered from YAML files in the definitions directory.
 */
export function loadAllAgentDefinitions(): Map<string, AgentDefinition> {
	const types = getKnownAgentTypes();
	const result = new Map<string, AgentDefinition>();
	for (const agentType of types) {
		result.set(agentType, loadAgentDefinition(agentType));
	}
	return result;
}

/**
 * Return the list of known agent types (derived from YAML filenames).
 */
export function getKnownAgentTypes(): string[] {
	if (knownTypes) return knownTypes;

	const entries = readdirSync(__dirname);
	knownTypes = entries
		.filter((f) => f.endsWith('.yaml'))
		.map((f) => f.replace(/\.yaml$/, ''))
		.sort();
	return knownTypes;
}

/**
 * Clear the loader cache (useful in tests).
 */
export function clearDefinitionCache(): void {
	cache.clear();
	knownTypes = null;
}
