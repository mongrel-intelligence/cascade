import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { CAPABILITIES } from '../../agents/capabilities/index.js';
import {
	getBuiltinAgentTypes,
	invalidateDefinitionCache,
	isBuiltinAgentType,
	loadBuiltinDefinition,
	resolveAgentDefinition,
	resolveKnownAgentTypes,
} from '../../agents/definitions/loader.js';
import {
	type AgentDefinition,
	AgentDefinitionSchema,
	DefinitionPatchSchema,
} from '../../agents/definitions/schema.js';
import { getRawTemplate, validateTemplate } from '../../agents/prompts/index.js';
import {
	deleteAgentDefinition,
	getAgentDefinitionMetadata,
	listAgentDefinitions,
	upsertAgentDefinition,
} from '../../db/repositories/agentDefinitionsRepository.js';
import { loadPartials } from '../../db/repositories/partialsRepository.js';
import { clearAgentTypeReferences } from '../../db/repositories/workflowStatusDefinitionsRepository.js';
import { logger } from '../../utils/logging.js';
import { listWorkflowStatusDefinitions } from '../../workflow/statusDefinitions.js';
import { publicProcedure, router, superAdminProcedure } from '../trpc.js';
import { TRIGGER_REGISTRY } from './_shared/triggerTypes.js';

const STATUS_CHANGED_TRIGGER_EVENT = 'pm:status-changed';

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

/**
 * Resolve an agent definition or throw a NOT_FOUND TRPCError.
 * Consolidates the 4 identical try/catch blocks across this router.
 */
async function resolveDefinitionOrThrow(agentType: string) {
	try {
		return await resolveAgentDefinition(agentType);
	} catch {
		throw new TRPCError({
			code: 'NOT_FOUND',
			message: `Agent definition not found: ${agentType}`,
		});
	}
}

async function assertWorkflowStatusDispatchCompatibility(
	agentType: string,
	definition: AgentDefinition,
) {
	if (definition.triggers.some((trigger) => trigger.event === STATUS_CHANGED_TRIGGER_EVENT)) {
		return;
	}

	const referencingStatuses = (await listWorkflowStatusDefinitions()).filter(
		(status) => status.agentType === agentType,
	);
	if (referencingStatuses.length === 0) return;

	throw new TRPCError({
		code: 'BAD_REQUEST',
		message: `Agent definition '${agentType}' is used by workflow status dispatch and must declare ${STATUS_CHANGED_TRIGGER_EVENT}`,
	});
}

export const agentDefinitionsRouter = router({
	/**
	 * Returns all definitions (YAML + DB merged), with agentType, definition, and isBuiltin flag.
	 *
	 * Uses a single listAgentDefinitions() call + YAML fallback instead of going through
	 * resolveAllAgentDefinitions() which would issue its own redundant listAgentDefinitions() call.
	 */
	list: superAdminProcedure.query(async () => {
		// getBuiltinAgentTypes() enumerates YAML types for the merge loop below.
		// resolveKnownAgentTypes() also hits the DB, which we already cover via
		// listAgentDefinitions(); calling both would be redundant.
		const yamlTypes = getBuiltinAgentTypes();
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

		// Fill in YAML-only types not present in DB.
		// loadBuiltinDefinition() is used here because this is a synchronous fallback path —
		// we already have the YAML type list and just need the raw definition content;
		// the async resolveAgentDefinition() would add unnecessary DB round-trips.
		for (const agentType of yamlTypes) {
			if (!seen.has(agentType)) {
				result.push({
					agentType,
					definition: loadBuiltinDefinition(agentType),
					isBuiltin: true, // YAML-only types are always builtin
				});
			}
		}

		return result;
	}),

	/**
	 * Returns a single definition by agentType, or throws NOT_FOUND.
	 */
	get: superAdminProcedure
		.input(z.object({ agentType: z.string().min(1) }))
		.query(async ({ input }) => {
			// Try the resolver (cache → DB → YAML)
			try {
				const definition = await resolveAgentDefinition(input.agentType);
				// isBuiltin = true if the agentType has a backing YAML file
				const isBuiltin = isBuiltinAgentType(input.agentType);
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
			// Validate agentType doesn't already exist in DB without parsing the stored body.
			const existing = await getAgentDefinitionMetadata(input.agentType);
			if (existing !== null) {
				throw new TRPCError({
					code: 'CONFLICT',
					message: `Agent definition already exists: ${input.agentType}`,
				});
			}
			const isBuiltin = isBuiltinAgentType(input.agentType);
			await assertWorkflowStatusDispatchCompatibility(input.agentType, input.definition);
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
			const current = await resolveDefinitionOrThrow(input.agentType);

			// Merge the patch into the current definition
			const merged = { ...current, ...input.patch };
			// Full-schema validate the merged result
			const validated = AgentDefinitionSchema.parse(merged);
			if ('triggers' in input.patch) {
				await assertWorkflowStatusDispatchCompatibility(input.agentType, validated);
			}

			const isBuiltin = isBuiltinAgentType(input.agentType);
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
			// Verify the definition exists in DB without parsing the stored body.
			const dbRow = await getAgentDefinitionMetadata(input.agentType);
			if (dbRow === null) {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: `Agent definition not found in database: ${input.agentType}`,
				});
			}

			// Check if it's a builtin (YAML-backed) type — those cannot be deleted
			const isYamlBuiltin = isBuiltinAgentType(input.agentType);
			if (isYamlBuiltin) {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: `Cannot delete builtin agent definition: ${input.agentType}. Use reset to restore it.`,
				});
			}

			// Keep this sequential in the same delete code path. A hard FK is not possible
			// because YAML-only agent types are valid workflow status references but have
			// no DB row; the cleanup update is idempotent and safe if it matches zero rows.
			await deleteAgentDefinition(input.agentType);
			const clearedWorkflowStatuses = await clearAgentTypeReferences(input.agentType);
			if (clearedWorkflowStatuses > 0) {
				logger.info('Cleared workflow status agent references after agent definition delete', {
					agentType: input.agentType,
					clearedWorkflowStatuses,
				});
			}
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
			const isYamlBuiltin = isBuiltinAgentType(input.agentType);
			if (!isYamlBuiltin) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: `Cannot reset non-builtin agent definition: ${input.agentType}`,
				});
			}

			// Re-read the YAML (bypass cache).
			// loadBuiltinDefinition() is used here because this endpoint explicitly needs the
			// raw YAML definition — the purpose of reset is to bypass any DB override and
			// restore the hard-coded YAML defaults.
			invalidateDefinitionCache();
			const yamlDefinition = loadBuiltinDefinition(input.agentType);
			await assertWorkflowStatusDispatchCompatibility(input.agentType, yamlDefinition);
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
			const current = await resolveDefinitionOrThrow(input.agentType);
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

			const current = await resolveDefinitionOrThrow(input.agentType);

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

			const isBuiltin = isBuiltinAgentType(input.agentType);
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
			const current = await resolveDefinitionOrThrow(input.agentType);
			const isBuiltin = isBuiltinAgentType(input.agentType);
			if (!isBuiltin) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: `No built-in prompt defaults exist for custom agent: ${input.agentType}`,
				});
			}

			// Load YAML defaults and use its prompts section
			let yamlDefault: AgentDefinition;
			try {
				yamlDefault = loadBuiltinDefinition(input.agentType);
			} catch {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: `YAML default not found for agent: ${input.agentType}`,
				});
			}

			// Restore system prompt from .eta file — YAML definitions don't include systemPrompt
			let systemPrompt: string | undefined = yamlDefault.prompts.systemPrompt;
			if (!systemPrompt) {
				try {
					systemPrompt = getRawTemplate(input.agentType);
				} catch {
					// No .eta file for this agent type
				}
			}

			// Replace prompts with YAML defaults + restored system prompt
			const updated: AgentDefinition = {
				...current,
				prompts: { ...yamlDefault.prompts, systemPrompt },
			};
			const validated = AgentDefinitionSchema.parse(updated);

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
			triggerRegistry: TRIGGER_REGISTRY,
		};
	}),
});
