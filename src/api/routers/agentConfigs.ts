import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { CLAUDE_CODE_MODELS } from '../../backends/claude-code/models.js';
import { getDb } from '../../db/client.js';
import {
	createAgentConfig,
	deleteAgentConfig,
	listAgentConfigs,
	updateAgentConfig,
} from '../../db/repositories/settingsRepository.js';
import { agentConfigs } from '../../db/schema/index.js';
import type { TRPCContext } from '../trpc.js';
import { protectedProcedure, publicProcedure, router } from '../trpc.js';
import { verifyProjectOrgAccess } from './_shared/projectAccess.js';

/** Throws FORBIDDEN when a global config (no org, no project) is modified by a non-superadmin. */
function assertCanModifyConfig(
	config: { orgId: string | null; projectId: string | null },
	ctx: { user: TRPCContext['user'] & object },
) {
	if (!config.orgId && !config.projectId && ctx.user.role !== 'superadmin') {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Superadmin access required' });
	}
}

export const agentConfigsRouter = router({
	claudeCodeModels: publicProcedure.query(() => {
		return CLAUDE_CODE_MODELS;
	}),

	list: protectedProcedure
		.input(z.object({ projectId: z.string().optional() }).optional())
		.query(async ({ ctx, input }) => {
			if (input?.projectId) {
				// Verify project belongs to org
				await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);
				return listAgentConfigs({ projectId: input.projectId });
			}
			return listAgentConfigs({ orgId: ctx.effectiveOrgId });
		}),

	// No superadmin check needed: the `input.orgId ?? ctx.effectiveOrgId` fallback
	// guarantees an orgId is always set, so a truly global config (no org, no project)
	// cannot be created through this endpoint.
	create: protectedProcedure
		.input(
			z.object({
				orgId: z.string().nullish(),
				projectId: z.string().nullish(),
				agentType: z.string().min(1),
				model: z.string().nullish(),
				maxIterations: z.number().int().positive().nullish(),
				agentBackend: z.string().nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			// If projectId given, verify ownership
			if (input.projectId) {
				await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);
			}
			return createAgentConfig({
				orgId: input.orgId ?? ctx.effectiveOrgId,
				projectId: input.projectId,
				agentType: input.agentType,
				model: input.model,
				maxIterations: input.maxIterations,
				agentBackend: input.agentBackend,
			});
		}),

	update: protectedProcedure
		.input(
			z.object({
				id: z.number(),
				agentType: z.string().min(1).optional(),
				model: z.string().nullish(),
				maxIterations: z.number().int().positive().nullish(),
				agentBackend: z.string().nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			// Verify ownership
			const db = getDb();
			const [config] = await db
				.select({ orgId: agentConfigs.orgId, projectId: agentConfigs.projectId })
				.from(agentConfigs)
				.where(eq(agentConfigs.id, input.id));
			if (!config) {
				throw new TRPCError({ code: 'NOT_FOUND' });
			}
			assertCanModifyConfig(config, ctx);
			// Check org-scoped configs belong to user's org
			if (config.orgId && config.orgId !== ctx.effectiveOrgId) {
				throw new TRPCError({ code: 'NOT_FOUND' });
			}
			// Check project-scoped configs belong to user's org
			if (config.projectId) {
				await verifyProjectOrgAccess(config.projectId, ctx.effectiveOrgId);
			}

			const { id, ...updates } = input;
			await updateAgentConfig(id, updates);
		}),

	delete: protectedProcedure
		.input(z.object({ id: z.number() }))
		.mutation(async ({ ctx, input }) => {
			const db = getDb();
			const [config] = await db
				.select({ orgId: agentConfigs.orgId, projectId: agentConfigs.projectId })
				.from(agentConfigs)
				.where(eq(agentConfigs.id, input.id));
			if (!config) {
				throw new TRPCError({ code: 'NOT_FOUND' });
			}
			assertCanModifyConfig(config, ctx);
			if (config.orgId && config.orgId !== ctx.effectiveOrgId) {
				throw new TRPCError({ code: 'NOT_FOUND' });
			}
			if (config.projectId) {
				await verifyProjectOrgAccess(config.projectId, ctx.effectiveOrgId);
			}

			await deleteAgentConfig(input.id);
		}),
});
