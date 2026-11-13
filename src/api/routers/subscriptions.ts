import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
	createSubscription,
	deleteSubscription,
	getSubscriptionProjectId,
	listSubscriptions,
	setSubscriptionEnabled,
} from '../../db/repositories/subscriptionsRepository.js';
import { protectedProcedure, router } from '../trpc.js';
import { verifyProjectOrgAccess } from './_shared/projectAccess.js';

async function authorizeSubscription(id: number, orgId: string): Promise<void> {
	const projectId = await getSubscriptionProjectId(id);
	if (!projectId) throw new TRPCError({ code: 'NOT_FOUND' });
	await verifyProjectOrgAccess(projectId, orgId);
}

export const subscriptionsRouter = router({
	list: protectedProcedure
		.input(z.object({ projectId: z.string() }))
		.query(async ({ ctx, input }) => {
			await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);
			// The token is never returned.
			return (await listSubscriptions(input.projectId)).map((s) => ({
				id: s.id,
				name: s.name,
				enabled: s.enabled,
				fiveHourPct: s.fiveHourPct,
				fiveHourResetAt: s.fiveHourResetAt?.toISOString() ?? null,
				sevenDayPct: s.sevenDayPct,
				sevenDayResetAt: s.sevenDayResetAt?.toISOString() ?? null,
			}));
		}),

	create: protectedProcedure
		.input(
			z.object({
				projectId: z.string(),
				name: z.string().min(1).max(50),
				token: z.string().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);
			return { id: await createSubscription(input.projectId, input.name, input.token) };
		}),

	setEnabled: protectedProcedure
		.input(z.object({ id: z.number().int(), enabled: z.boolean() }))
		.mutation(async ({ ctx, input }) => {
			await authorizeSubscription(input.id, ctx.effectiveOrgId);
			await setSubscriptionEnabled(input.id, input.enabled);
		}),

	delete: protectedProcedure
		.input(z.object({ id: z.number().int() }))
		.mutation(async ({ ctx, input }) => {
			await authorizeSubscription(input.id, ctx.effectiveOrgId);
			await deleteSubscription(input.id);
		}),
});
