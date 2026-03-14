import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { type AgentDefinition, AgentDefinitionSchema } from './schema.js';

// ============================================================================
// YAML Loader
// ============================================================================

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Cache of parsed + validated agent definitions (shared by sync and async paths) */
const cache = new Map<string, AgentDefinition>();

/** Lazily discovered set of agent types (from YAML filenames) */
let knownTypes: string[] | null = null;

/**
 * Load and validate a single agent definition from YAML.
 * Results are cached after first load.
 *
 * @deprecated Use `resolveAgentDefinition()` instead (checks cache → DB → YAML).
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
 *
 * @deprecated Use `resolveAllAgentDefinitions()` instead (checks DB with YAML fallback).
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
 *
 * @deprecated Use `resolveKnownAgentTypes()` instead (returns types from both DB and YAML).
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

/**
 * Returns true if the given agentType has a backing YAML file (i.e. is a built-in type).
 * Wraps `getKnownAgentTypes().includes()` to avoid repeated deprecated-function calls at each
 * call site.
 */
export function isBuiltinAgentType(agentType: string): boolean {
	return getKnownAgentTypes().includes(agentType);
}

// ============================================================================
// Async Resolver (Cache → DB → YAML fallback)
// ============================================================================

/**
 * Resolve a single agent definition using a three-tier lookup:
 *   1. In-memory cache (fastest)
 *   2. Database lookup via `getAgentDefinition()`
 *   3. YAML file fallback (existing sync loader)
 */
export async function resolveAgentDefinition(agentType: string): Promise<AgentDefinition> {
	// 1. Check the shared in-memory cache
	const cached = cache.get(agentType);
	if (cached) return cached;

	// 2. Check the database
	try {
		const { getAgentDefinition } = await import(
			'../../db/repositories/agentDefinitionsRepository.js'
		);
		const fromDb = await getAgentDefinition(agentType);
		if (fromDb) {
			cache.set(agentType, fromDb);
			return fromDb;
		}
	} catch {
		// DB unavailable — fall through to YAML
	}

	// 3. YAML fallback
	return loadAgentDefinition(agentType);
}

/**
 * Resolve all agent definitions, merging DB entries with YAML fallbacks for any
 * types not found in the database.
 *
 * Returns a `Map<agentType, AgentDefinition>` covering all known agent types.
 */
export async function resolveAllAgentDefinitions(): Promise<Map<string, AgentDefinition>> {
	const yamlTypes = getKnownAgentTypes();
	const result = new Map<string, AgentDefinition>();

	// Fetch all DB entries first
	const dbTypes = new Set<string>();
	try {
		const { listAgentDefinitions } = await import(
			'../../db/repositories/agentDefinitionsRepository.js'
		);
		const rows = await listAgentDefinitions();
		for (const row of rows) {
			result.set(row.agentType, row.definition);
			cache.set(row.agentType, row.definition);
			dbTypes.add(row.agentType);
		}
	} catch {
		// DB unavailable — fill everything from YAML
	}

	// Fill missing types from YAML
	for (const agentType of yamlTypes) {
		if (!result.has(agentType)) {
			result.set(agentType, loadAgentDefinition(agentType));
		}
	}

	return result;
}

/**
 * Return all known agent types, combining DB-registered types with YAML-discovered types.
 */
export async function resolveKnownAgentTypes(): Promise<string[]> {
	const yamlTypes = new Set(getKnownAgentTypes());

	try {
		const { listAgentDefinitions } = await import(
			'../../db/repositories/agentDefinitionsRepository.js'
		);
		const rows = await listAgentDefinitions();
		for (const row of rows) {
			yamlTypes.add(row.agentType);
		}
	} catch {
		// DB unavailable — return YAML types only
	}

	return [...yamlTypes].sort();
}

/**
 * Invalidate the in-memory definition cache so the next resolve hits the DB.
 * Call this after writing a definition to the database.
 */
export function invalidateDefinitionCache(): void {
	cache.clear();
	knownTypes = null;
}

// ============================================================================
// PM-Focused Agent Detection
// ============================================================================

/**
 * Returns true if an agent is PM-focused: it requires 'pm' integration but NOT 'scm'.
 *
 * PM-focused agents (e.g. backlog-manager) should have their ack comments posted to
 * the PM tool (Trello/JIRA card) rather than a GitHub PR, since they don't interact
 * with GitHub PRs directly.
 *
 * Uses the explicit `integrations.required` field from the agent definition when
 * available; otherwise falls back to capability-derived integrations.
 *
 * Results are NOT cached separately — the agent definition itself is cached by the
 * loader, so repeated calls are inexpensive.
 */
export async function isPMFocusedAgent(agentType: string): Promise<boolean> {
	try {
		const def = await resolveAgentDefinition(agentType);
		const requiredIntegrations = def.integrations?.required ?? [];
		const hasPM = requiredIntegrations.includes('pm');
		const hasSCM = requiredIntegrations.includes('scm');
		// If explicit integrations are not defined, fall back to capability-derived check
		if (requiredIntegrations.length === 0) {
			// No explicit integrations: check capabilities (pm: prefix required, no scm: prefix required)
			const caps = def.capabilities.required;
			const capHasPM = caps.some((c) => c.startsWith('pm:'));
			const capHasSCM = caps.some((c) => c.startsWith('scm:'));
			return capHasPM && !capHasSCM;
		}
		return hasPM && !hasSCM;
	} catch {
		return false;
	}
}
