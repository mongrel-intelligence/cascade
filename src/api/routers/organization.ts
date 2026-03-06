import { z } from 'zod';
import {
	getOrganization,
	listAllOrganizations,
	updateOrganization,
} from '../../db/repositories/settingsRepository.js';
import { adminProcedure, protectedProcedure, router, superAdminProcedure } from '../trpc.js';

export const organizationRouter = router({
	get: protectedProcedure.query(async ({ ctx }) => {
		return getOrganization(ctx.effectiveOrgId);
	}),

	update: adminProcedure
		.input(z.object({ name: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			await updateOrganization(ctx.effectiveOrgId, { name: input.name });
		}),

	list: superAdminProcedure.query(async () => {
		return listAllOrganizations();
	}),
});
