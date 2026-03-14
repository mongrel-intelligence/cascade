import { z } from 'zod';
import { EngineSettingsSchema } from '../../config/engineSettings.js';
import {
	getCascadeDefaults,
	upsertCascadeDefaults,
} from '../../db/repositories/settingsRepository.js';
import { protectedProcedure, router } from '../trpc.js';

function serializeDefaults(row: Awaited<ReturnType<typeof getCascadeDefaults>>) {
	if (!row) return null;
	const { agentEngineSettings, ...rest } = row;
	return {
		...rest,
		engineSettings: agentEngineSettings ?? null,
	};
}

export const defaultsRouter = router({
	get: protectedProcedure.query(async ({ ctx }) => {
		return serializeDefaults(await getCascadeDefaults(ctx.effectiveOrgId));
	}),

	upsert: protectedProcedure
		.input(
			z.object({
				model: z.string().nullish(),
				maxIterations: z.number().int().positive().nullish(),
				watchdogTimeoutMs: z.number().int().positive().nullish(),
				workItemBudgetUsd: z.string().nullish(),
				agentEngine: z.string().nullish(),
				engineSettings: EngineSettingsSchema.nullish(),
				progressModel: z.string().nullish(),
				progressIntervalMinutes: z.string().nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await upsertCascadeDefaults(ctx.effectiveOrgId, {
				...input,
				...(input.agentEngine !== undefined ? { agentEngine: input.agentEngine } : {}),
				...(input.engineSettings !== undefined ? { engineSettings: input.engineSettings } : {}),
			});
		}),
});
