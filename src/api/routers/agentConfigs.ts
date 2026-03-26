import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { resolveAgentDefinition } from '../../agents/definitions/index.js';
import {
	getDefaultTaskPrompt,
	getRawTemplate,
	validateTemplate,
} from '../../agents/prompts/index.js';
import { getEngineCatalog, registerBuiltInEngines } from '../../backends/index.js';
import { EngineSettingsSchema } from '../../config/engineSettings.js';
import { getDb } from '../../db/client.js';
import { loadPartials } from '../../db/repositories/partialsRepository.js';
import {
	createAgentConfig,
	deleteAgentConfig,
	getAgentConfigPrompts,
	listAgentConfigs,
	listDistinctEnginesByProject,
	updateAgentConfig,
} from '../../db/repositories/settingsRepository.js';
import { agentConfigs } from '../../db/schema/index.js';
import { protectedProcedure, publicProcedure, router } from '../trpc.js';
import { verifyProjectOrgAccess } from './_shared/projectAccess.js';

/**
 * Validate an optional prompt template string.
 * Throws BAD_REQUEST if the Eta syntax is invalid.
 */
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

export const agentConfigsRouter = router({
	engines: publicProcedure.query(() => {
		registerBuiltInEngines();
		return getEngineCatalog();
	}),

	/**
	 * Returns the distinct set of engine IDs actively used by agent configs in a project.
	 * Includes only non-null agent_engine overrides — does not include the project-level default engine.
	 * The frontend merges this with the project-level effectiveEngineId to show all needed credentials.
	 */
	enginesInUse: protectedProcedure
		.input(z.object({ projectId: z.string() }))
		.query(async ({ ctx, input }) => {
			// Verify project belongs to org
			await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);
			return listDistinctEnginesByProject(input.projectId);
		}),

	list: protectedProcedure
		.input(z.object({ projectId: z.string() }))
		.query(async ({ ctx, input }) => {
			// Verify project belongs to org
			await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);
			return listAgentConfigs({ projectId: input.projectId });
		}),

	create: protectedProcedure
		.input(
			z.object({
				projectId: z.string(),
				agentType: z.string().min(1),
				model: z.string().nullish(),
				maxIterations: z.number().int().positive().nullish(),
				agentEngine: z.string().nullish(),
				engineSettings: EngineSettingsSchema.nullish(),
				maxConcurrency: z.number().int().positive().nullish(),
				systemPrompt: z.string().nullish(),
				taskPrompt: z.string().nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			// Verify project ownership
			await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);

			// Validate prompt templates before saving
			await validatePromptIfPresent(input.systemPrompt);
			await validatePromptIfPresent(input.taskPrompt);

			return createAgentConfig({
				projectId: input.projectId,
				agentType: input.agentType,
				model: input.model,
				maxIterations: input.maxIterations,
				...(input.agentEngine !== undefined ? { agentEngine: input.agentEngine } : {}),
				...(input.engineSettings !== undefined ? { engineSettings: input.engineSettings } : {}),
				...(input.maxConcurrency !== undefined ? { maxConcurrency: input.maxConcurrency } : {}),
				...(input.systemPrompt !== undefined ? { systemPrompt: input.systemPrompt } : {}),
				...(input.taskPrompt !== undefined ? { taskPrompt: input.taskPrompt } : {}),
			});
		}),

	update: protectedProcedure
		.input(
			z.object({
				id: z.number(),
				agentType: z.string().min(1).optional(),
				model: z.string().nullish(),
				maxIterations: z.number().int().positive().nullish(),
				agentEngine: z.string().nullish(),
				engineSettings: EngineSettingsSchema.nullish(),
				maxConcurrency: z.number().int().positive().nullish(),
				systemPrompt: z.string().nullish(),
				taskPrompt: z.string().nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			// Verify ownership
			const db = getDb();
			const [config] = await db
				.select({ projectId: agentConfigs.projectId })
				.from(agentConfigs)
				.where(eq(agentConfigs.id, input.id));
			if (!config) {
				throw new TRPCError({ code: 'NOT_FOUND' });
			}
			// Check project-scoped configs belong to user's org
			await verifyProjectOrgAccess(config.projectId, ctx.effectiveOrgId);

			// Validate prompt templates before saving
			await validatePromptIfPresent(input.systemPrompt);
			await validatePromptIfPresent(input.taskPrompt);

			const { id, engineSettings, systemPrompt, taskPrompt, ...updates } = input;
			await updateAgentConfig(id, {
				...updates,
				...(input.agentEngine !== undefined ? { agentEngine: input.agentEngine } : {}),
				...(engineSettings !== undefined ? { engineSettings } : {}),
				...(systemPrompt !== undefined ? { systemPrompt } : {}),
				...(taskPrompt !== undefined ? { taskPrompt } : {}),
			});
		}),

	delete: protectedProcedure
		.input(z.object({ id: z.number() }))
		.mutation(async ({ ctx, input }) => {
			const db = getDb();
			const [config] = await db
				.select({ projectId: agentConfigs.projectId })
				.from(agentConfigs)
				.where(eq(agentConfigs.id, input.id));
			if (!config) {
				throw new TRPCError({ code: 'NOT_FOUND' });
			}
			await verifyProjectOrgAccess(config.projectId, ctx.effectiveOrgId);

			await deleteAgentConfig(input.id);
		}),

	/**
	 * Returns prompt overrides for a given (projectId, agentType), merged with
	 * global definition defaults and disk template defaults.
	 *
	 * Resolution chain:
	 * - projectSystemPrompt / projectTaskPrompt: project-level override from agent_configs
	 * - globalSystemPrompt / globalTaskPrompt: from the resolved agent definition (DB or YAML)
	 * - defaultSystemPrompt: raw .eta template from disk (before rendering)
	 */
	getPrompts: protectedProcedure
		.input(z.object({ projectId: z.string(), agentType: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			// Verify project belongs to org
			await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);

			// 1. Project-level overrides from agent_configs table
			const { systemPrompt: projectSystemPrompt, taskPrompt: projectTaskPrompt } =
				await getAgentConfigPrompts(input.projectId, input.agentType);

			// 2. Global definition prompts (DB or YAML)
			let globalSystemPrompt: string | null = null;
			let globalTaskPrompt: string | null = null;
			try {
				const definition = await resolveAgentDefinition(input.agentType);
				globalSystemPrompt = definition.prompts.systemPrompt ?? null;
				globalTaskPrompt = definition.prompts.taskPrompt ?? null;
			} catch {
				// Agent type not found — skip global prompts gracefully
			}

			// 3. Raw disk template (before Eta rendering)
			let defaultSystemPrompt: string | null = null;
			try {
				defaultSystemPrompt = getRawTemplate(input.agentType);
			} catch {
				// No .eta template on disk — skip gracefully
			}

			// 4. YAML-defined task prompt (factory default)
			const defaultTaskPrompt = getDefaultTaskPrompt(input.agentType);

			return {
				projectSystemPrompt,
				projectTaskPrompt,
				globalSystemPrompt,
				globalTaskPrompt,
				defaultSystemPrompt,
				defaultTaskPrompt,
			};
		}),
});
