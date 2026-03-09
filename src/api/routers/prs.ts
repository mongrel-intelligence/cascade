import { z } from 'zod';
import {
	listPRsForProject,
	listPRsForWorkItem,
} from '../../db/repositories/prWorkItemsRepository.js';
import { getRunsForPR } from '../../db/repositories/runsRepository.js';
import { protectedProcedure, router } from '../trpc.js';
import { verifyProjectOrgAccess } from './_shared/projectAccess.js';

export const prsRouter = router({
	list: protectedProcedure
		.input(z.object({ projectId: z.string() }))
		.query(async ({ ctx, input }) => {
			await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);
			const prs = await listPRsForProject(input.projectId);
			return prs;
		}),

	forWorkItem: protectedProcedure
		.input(z.object({ projectId: z.string(), workItemId: z.string() }))
		.query(async ({ ctx, input }) => {
			await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);
			const prs = await listPRsForWorkItem(input.projectId, input.workItemId);
			return prs;
		}),

	runs: protectedProcedure
		.input(z.object({ projectId: z.string(), prNumber: z.number().int() }))
		.query(async ({ ctx, input }) => {
			await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);
			const runs = await getRunsForPR(input.projectId, input.prNumber);
			return runs;
		}),
});
