import { z } from 'zod';
import { getOrganization, updateOrganization } from '../../db/repositories/settingsRepository.js';
import { protectedProcedure, router } from '../trpc.js';

export const organizationRouter = router({
	get: protectedProcedure.query(async ({ ctx }) => {
		return getOrganization(ctx.user.orgId);
	}),

	update: protectedProcedure
		.input(z.object({ name: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			await updateOrganization(ctx.user.orgId, { name: input.name });
		}),
});
