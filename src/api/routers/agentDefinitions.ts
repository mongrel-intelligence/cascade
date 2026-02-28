import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
	getKnownAgentTypes,
	invalidateDefinitionCache,
	loadAgentDefinition,
	resolveAgentDefinition,
	resolveAllAgentDefinitions,
	resolveKnownAgentTypes,
} from '../../agents/definitions/loader.js';
import {
	AgentDefinitionSchema,
	COMPACTION_NAMES,
	CONTEXT_STEP_NAMES,
	DefinitionPatchSchema,
	GADGET_BUILDER_NAMES,
	SDK_TOOLS_NAMES,
	TASK_PROMPT_BUILDER_NAMES,
	TOOL_SET_NAMES,
} from '../../agents/definitions/schema.js';
import {
	deleteAgentDefinition,
	getAgentDefinition,
	listAgentDefinitions,
	upsertAgentDefinition,
} from '../../db/repositories/agentDefinitionsRepository.js';
import { protectedProcedure, publicProcedure, router, superAdminProcedure } from '../trpc.js';

export const agentDefinitionsRouter = router({
	/**
	 * Returns all definitions (YAML + DB merged), with agentType, definition, and isBuiltin flag.
	 */
	list: protectedProcedure.query(async () => {
		const all = await resolveAllAgentDefinitions();
		const dbRows = await listAgentDefinitions().catch((err) => {
			console.warn('Failed to fetch agent definitions from DB, falling back to YAML only', err);
			return [];
		});
		const dbMap = new Map(dbRows.map((r) => [r.agentType, r]));

		return [...all.entries()].map(([agentType, definition]) => {
			const dbRow = dbMap.get(agentType);
			return {
				agentType,
				definition,
				isBuiltin: dbRow?.isBuiltin ?? true, // YAML-only types are builtin
			};
		});
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
				// Log the original error so infrastructure issues are visible
				console.error(`Failed to resolve agent definition: ${input.agentType}`, err);
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
			const existing = await getAgentDefinition(input.agentType).catch(() => null);
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
			const dbRow = await getAgentDefinition(input.agentType).catch(() => null);
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
			toolSetNames: [...TOOL_SET_NAMES],
			sdkToolsNames: [...SDK_TOOLS_NAMES],
			contextStepNames: [...CONTEXT_STEP_NAMES],
			taskPromptBuilderNames: [...TASK_PROMPT_BUILDER_NAMES],
			gadgetBuilderNames: [...GADGET_BUILDER_NAMES],
			compactionNames: [...COMPACTION_NAMES],
		};
	}),
});
