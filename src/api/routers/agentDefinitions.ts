import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { CAPABILITIES } from '../../agents/capabilities/index.js';
import {
	getKnownAgentTypes,
	invalidateDefinitionCache,
	loadAgentDefinition,
	resolveAgentDefinition,
	resolveKnownAgentTypes,
} from '../../agents/definitions/loader.js';
import {
	type AgentDefinition,
	AgentDefinitionSchema,
	COMPACTION_NAMES,
	CONTEXT_STEP_NAMES,
	DefinitionPatchSchema,
} from '../../agents/definitions/schema.js';
import { validateTemplate } from '../../agents/prompts/index.js';
import {
	deleteAgentDefinition,
	getAgentDefinition,
	listAgentDefinitions,
	upsertAgentDefinition,
} from '../../db/repositories/agentDefinitionsRepository.js';
import { loadPartials } from '../../db/repositories/partialsRepository.js';
import { protectedProcedure, publicProcedure, router, superAdminProcedure } from '../trpc.js';
import { TRIGGER_REGISTRY } from './_shared/triggerTypes.js';

async function validatePromptIfPresent(prompt: string | null | undefined) {
	if (!prompt) return;
	const dbPartials = await loadPartials();
	const result = validateTemplate(prompt, dbPartials);
	if (!result.valid) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: `Invalid prompt template: ${result.error}`,
		});
	}
}

export const agentDefinitionsRouter = router({
	/**
	 * Returns all definitions (YAML + DB merged), with agentType, definition, and isBuiltin flag.
	 *
	 * Uses a single listAgentDefinitions() call + YAML fallback instead of going through
	 * resolveAllAgentDefinitions() which would issue its own redundant listAgentDefinitions() call.
	 */
	list: protectedProcedure.query(async () => {
		const yamlTypes = getKnownAgentTypes();
		const result: Array<{ agentType: string; definition: AgentDefinition; isBuiltin: boolean }> =
			[];

		// Fetch DB rows (includes isBuiltin flag)
		const dbRows = await listAgentDefinitions().catch((err) => {
			console.warn('Failed to fetch agent definitions from DB, falling back to YAML only', err);
			return [] as Array<{ agentType: string; definition: AgentDefinition; isBuiltin: boolean }>;
		});
		const seen = new Set<string>();

		// Start with all DB entries
		for (const row of dbRows) {
			result.push({
				agentType: row.agentType,
				definition: row.definition,
				isBuiltin: row.isBuiltin,
			});
			seen.add(row.agentType);
		}

		// Fill in YAML-only types not present in DB
		for (const agentType of yamlTypes) {
			if (!seen.has(agentType)) {
				result.push({
					agentType,
					definition: loadAgentDefinition(agentType),
					isBuiltin: true, // YAML-only types are always builtin
				});
			}
		}

		return result;
	}),

	/**
	 * Returns a single definition by agentType, or throws NOT_FOUND.
	 */
	get: protectedProcedure
		.input(z.object({ agentType: z.string().min(1) }))
		.query(async ({ input }) => {
			// Try the resolver (cache → DB → YAML)
			try {
				const definition = await resolveAgentDefinition(input.agentType);
				// isBuiltin = true if the agentType has a backing YAML file
				const isBuiltin = getKnownAgentTypes().includes(input.agentType);
				return {
					agentType: input.agentType,
					definition,
					isBuiltin,
				};
			} catch (err) {
				// If it's already a TRPCError, re-throw it (preserves proper error codes)
				if (err instanceof TRPCError) {
					throw err;
				}
				// Log the original error so infrastructure issues are visible
				console.error(`Failed to resolve agent definition: ${input.agentType}`, err);
				// Only wrap as NOT_FOUND if it's genuinely not found
				// Other errors (DB down, etc.) should be INTERNAL_SERVER_ERROR
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: `Agent definition not found: ${input.agentType}`,
				});
			}
		}),

	/**
	 * Create a new agent definition (superadmin only).
	 * Validates the full definition via AgentDefinitionSchema. Invalidates cache.
	 */
	create: superAdminProcedure
		.input(
			z.object({
				agentType: z.string().min(1),
				definition: AgentDefinitionSchema,
			}),
		)
		.mutation(async ({ input }) => {
			// Validate agentType doesn't already exist in DB
			// getAgentDefinition returns null for not-found, throws for DB errors
			const existing = await getAgentDefinition(input.agentType);
			if (existing !== null) {
				throw new TRPCError({
					code: 'CONFLICT',
					message: `Agent definition already exists: ${input.agentType}`,
				});
			}
			const isBuiltin = getKnownAgentTypes().includes(input.agentType);
			await upsertAgentDefinition(input.agentType, input.definition, isBuiltin);
			invalidateDefinitionCache();
			return { agentType: input.agentType };
		}),

	/**
	 * Partial update by agentType (superadmin only). Uses DefinitionPatchSchema.
	 * Invalidates cache.
	 */
	update: superAdminProcedure
		.input(
			z.object({
				agentType: z.string().min(1),
				patch: DefinitionPatchSchema,
			}),
		)
		.mutation(async ({ input }) => {
			// Resolve the current definition (cache → DB → YAML)
			let current: Awaited<ReturnType<typeof resolveAgentDefinition>>;
			try {
				current = await resolveAgentDefinition(input.agentType);
			} catch {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: `Agent definition not found: ${input.agentType}`,
				});
			}

			// Merge the patch into the current definition
			const merged = { ...current, ...input.patch };
			// Full-schema validate the merged result
			const validated = AgentDefinitionSchema.parse(merged);

			const isBuiltin = getKnownAgentTypes().includes(input.agentType);
			await upsertAgentDefinition(input.agentType, validated, isBuiltin);
			invalidateDefinitionCache();
			return { agentType: input.agentType };
		}),

	/**
	 * Delete by agentType (superadmin only, non-builtin only). Invalidates cache.
	 */
	delete: superAdminProcedure
		.input(z.object({ agentType: z.string().min(1) }))
		.mutation(async ({ input }) => {
			// Verify the definition exists in DB
			// getAgentDefinition returns null for not-found, throws for DB errors
			const dbRow = await getAgentDefinition(input.agentType);
			if (dbRow === null) {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: `Agent definition not found in database: ${input.agentType}`,
				});
			}

			// Check if it's a builtin (YAML-backed) type — those cannot be deleted
			const isYamlBuiltin = getKnownAgentTypes().includes(input.agentType);
			if (isYamlBuiltin) {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: `Cannot delete builtin agent definition: ${input.agentType}. Use reset to restore it.`,
				});
			}

			await deleteAgentDefinition(input.agentType);
			invalidateDefinitionCache();
			return { agentType: input.agentType };
		}),

	/**
	 * Restore a builtin definition to its YAML default (superadmin only).
	 * Re-reads YAML and upserts. Invalidates cache.
	 */
	reset: superAdminProcedure
		.input(z.object({ agentType: z.string().min(1) }))
		.mutation(async ({ input }) => {
			const isYamlBuiltin = getKnownAgentTypes().includes(input.agentType);
			if (!isYamlBuiltin) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: `Cannot reset non-builtin agent definition: ${input.agentType}`,
				});
			}

			// Re-read the YAML (bypass cache)
			invalidateDefinitionCache();
			const yamlDefinition = loadAgentDefinition(input.agentType);
			await upsertAgentDefinition(input.agentType, yamlDefinition, true);
			invalidateDefinitionCache();
			return { agentType: input.agentType };
		}),

	/**
	 * Get the prompt overrides for a specific agent type (superadmin only).
	 */
	getPrompt: superAdminProcedure
		.input(z.object({ agentType: z.string().min(1) }))
		.query(async ({ input }) => {
			let current: AgentDefinition;
			try {
				current = await resolveAgentDefinition(input.agentType);
			} catch {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: `Agent definition not found: ${input.agentType}`,
				});
			}
			return {
				agentType: input.agentType,
				systemPrompt: current.prompts?.systemPrompt ?? null,
				taskPrompt: current.prompts?.taskPrompt ?? null,
			};
		}),

	/**
	 * Update (or clear) prompt overrides for an agent type (superadmin only).
	 */
	updatePrompt: superAdminProcedure
		.input(
			z.object({
				agentType: z.string().min(1),
				systemPrompt: z.string().nullish(),
				taskPrompt: z.string().nullish(),
			}),
		)
		.mutation(async ({ input }) => {
			await validatePromptIfPresent(input.systemPrompt);
			await validatePromptIfPresent(input.taskPrompt);

			let current: AgentDefinition;
			try {
				current = await resolveAgentDefinition(input.agentType);
			} catch {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: `Agent definition not found: ${input.agentType}`,
				});
			}

			// Build updated prompts section
			// Merge with existing prompts: undefined preserves current, null clears (for systemPrompt only), string sets
			// Note: taskPrompt is required by schema, so null is treated as "keep current" rather than "clear"
			const systemPrompt: string | undefined =
				input.systemPrompt === null
					? undefined
					: input.systemPrompt !== undefined
						? input.systemPrompt
						: current.prompts.systemPrompt;
			const taskPrompt: string =
				input.taskPrompt && input.taskPrompt !== null
					? input.taskPrompt
					: current.prompts.taskPrompt;

			const updated: AgentDefinition = {
				...current,
				prompts: { systemPrompt, taskPrompt },
			};
			const validated = AgentDefinitionSchema.parse(updated);

			const isBuiltin = getKnownAgentTypes().includes(input.agentType);
			await upsertAgentDefinition(input.agentType, validated, isBuiltin);
			invalidateDefinitionCache();
			return { agentType: input.agentType };
		}),

	/**
	 * Reset prompt overrides to YAML defaults for an agent type (superadmin only).
	 * Restores the prompts section from the YAML definition.
	 */
	resetPrompt: superAdminProcedure
		.input(z.object({ agentType: z.string().min(1) }))
		.mutation(async ({ input }) => {
			let current: AgentDefinition;
			try {
				current = await resolveAgentDefinition(input.agentType);
			} catch {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: `Agent definition not found: ${input.agentType}`,
				});
			}

			// Load YAML defaults and use its prompts section
			let yamlDefault: AgentDefinition;
			try {
				yamlDefault = loadAgentDefinition(input.agentType);
			} catch {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: `YAML default not found for agent: ${input.agentType}`,
				});
			}

			// Replace prompts with YAML defaults
			const updated: AgentDefinition = { ...current, prompts: yamlDefault.prompts };
			const validated = AgentDefinitionSchema.parse(updated);

			const isBuiltin = getKnownAgentTypes().includes(input.agentType);
			await upsertAgentDefinition(input.agentType, validated, isBuiltin);
			invalidateDefinitionCache();
			return { agentType: input.agentType };
		}),

	/**
	 * Returns list of all known agent types (publicProcedure for dashboard dropdowns).
	 */
	knownTypes: publicProcedure.query(async () => {
		return resolveKnownAgentTypes();
	}),

	/**
	 * Returns enum arrays for form dropdowns (publicProcedure).
	 */
	schema: publicProcedure.query(() => {
		return {
			capabilities: [...CAPABILITIES],
			contextStepNames: [...CONTEXT_STEP_NAMES],
			compactionNames: [...COMPACTION_NAMES],
			triggerRegistry: TRIGGER_REGISTRY,
		};
	}),
});
