import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getEngineCatalog, registerBuiltInEngines } from '../../backends/index.js';
import { EngineSettingsSchema } from '../../config/engineSettings.js';
import { getDb } from '../../db/client.js';
import {
	createAgentConfig,
	deleteAgentConfig,
	listAgentConfigs,
	updateAgentConfig,
} from '../../db/repositories/settingsRepository.js';
import { agentConfigs } from '../../db/schema/index.js';
import { protectedProcedure, publicProcedure, router } from '../trpc.js';
import { verifyProjectOrgAccess } from './_shared/projectAccess.js';

export const agentConfigsRouter = router({
	engines: publicProcedure.query(() => {
		registerBuiltInEngines();
		return getEngineCatalog();
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
				maxConcurrency: z.number().int().positive().nullish(),
				engineSettings: EngineSettingsSchema.nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			// Verify project ownership
			await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);

			return createAgentConfig({
				projectId: input.projectId,
				agentType: input.agentType,
				model: input.model,
				maxIterations: input.maxIterations,
				...(input.agentEngine !== undefined ? { agentEngine: input.agentEngine } : {}),
				...(input.maxConcurrency !== undefined ? { maxConcurrency: input.maxConcurrency } : {}),
				...(input.engineSettings !== undefined ? { engineSettings: input.engineSettings } : {}),
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
				maxConcurrency: z.number().int().positive().nullish(),
				engineSettings: EngineSettingsSchema.nullish(),
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

			const { id, engineSettings, ...updates } = input;
			await updateAgentConfig(id, {
				...updates,
				...(input.agentEngine !== undefined ? { agentEngine: input.agentEngine } : {}),
				...(engineSettings !== undefined ? { engineSettings } : {}),
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
});
