import { z } from 'zod';
import {
	getCascadeDefaults,
	upsertCascadeDefaults,
} from '../../db/repositories/settingsRepository.js';
import { protectedProcedure, router } from '../trpc.js';

export const defaultsRouter = router({
	get: protectedProcedure.query(async ({ ctx }) => {
		return getCascadeDefaults(ctx.user.orgId);
	}),

	upsert: protectedProcedure
		.input(
			z.object({
				model: z.string().nullish(),
				maxIterations: z.number().int().positive().nullish(),
				freshMachineTimeoutMs: z.number().int().positive().nullish(),
				watchdogTimeoutMs: z.number().int().positive().nullish(),
				postJobGracePeriodMs: z.number().int().positive().nullish(),
				cardBudgetUsd: z.string().nullish(),
				agentBackend: z.string().nullish(),
				progressModel: z.string().nullish(),
				progressIntervalMinutes: z.string().nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await upsertCascadeDefaults(ctx.user.orgId, input);
		}),
});
