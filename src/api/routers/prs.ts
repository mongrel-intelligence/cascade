import { z } from 'zod';
import {
	listPRsForOrg,
	listPRsForProject,
	listPRsForWorkItem,
	listUnifiedWorkForProject,
} from '../../db/repositories/prWorkItemsRepository.js';
import { getProjectWorkStats, getRunsForPR } from '../../db/repositories/runsRepository.js';
import { protectedProcedure, router } from '../trpc.js';
import { verifyProjectOrgAccess } from './_shared/projectAccess.js';

export const prsRouter = router({
	list: protectedProcedure
		.input(z.object({ projectId: z.string().optional() }))
		.query(async ({ ctx, input }) => {
			if (input.projectId) {
				await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);
				return listPRsForProject(input.projectId);
			}
			return listPRsForOrg(ctx.effectiveOrgId);
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

	listUnified: protectedProcedure
		.input(z.object({ projectId: z.string() }))
		.query(async ({ ctx, input }) => {
			await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);
			return listUnifiedWorkForProject(input.projectId);
		}),

	workStats: protectedProcedure
		.input(
			z.object({
				projectId: z.string(),
				dateFrom: z.string().optional(),
				agentType: z.string().optional(),
				status: z.string().optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);
			return getProjectWorkStats(input.projectId, {
				dateFrom: input.dateFrom ? new Date(input.dateFrom) : undefined,
				agentType: input.agentType,
				status: input.status,
			});
		}),
});
