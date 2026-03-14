import { z } from 'zod';
import { EngineSettingsSchema } from '../../config/engineSettings.js';
import { protectedProcedure, router } from '../trpc.js';

// The cascade_defaults table has been removed as of migration 0038.
// Global defaults are now handled via Zod schema defaults in CascadeConfigSchema.
// Per-project overrides (maxIterations, watchdogTimeoutMs, progressModel,
// progressIntervalMinutes) are stored directly on the projects table.

export const defaultsRouter = router({
	get: protectedProcedure.query(async () => {
		// No cascade_defaults table — return null to indicate no org-level overrides
		return null;
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
		.mutation(async () => {
			// No-op: cascade_defaults table has been removed as of migration 0038.
			// Project-level overrides should be set via the projects router.
			return {
				ok: true,
				deprecated: true,
				message:
					'Organization-level defaults have been removed. This call is a no-op. Use the projects router to set per-project overrides.',
			};
		}),
});
