import { z } from 'zod';
import { listWorkItemsForProject } from '../../db/repositories/prWorkItemsRepository.js';
import { getRunsByWorkItem } from '../../db/repositories/runsRepository.js';
import { protectedProcedure, router } from '../trpc.js';
import { verifyProjectOrgAccess } from './_shared/projectAccess.js';

export const workItemsRouter = router({
	list: protectedProcedure
		.input(z.object({ projectId: z.string() }))
		.query(async ({ ctx, input }) => {
			await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);
			const items = await listWorkItemsForProject(input.projectId);
			return items;
		}),

	runs: protectedProcedure
		.input(z.object({ projectId: z.string(), workItemId: z.string() }))
		.query(async ({ ctx, input }) => {
			await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);
			const runs = await getRunsByWorkItem(input.projectId, input.workItemId);
			return runs;
		}),
});
