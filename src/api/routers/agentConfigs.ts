import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { validateTemplate } from '../../agents/prompts/index.js';
import { CLAUDE_CODE_MODELS } from '../../backends/claude-code/models.js';
import { getDb } from '../../db/client.js';
import { loadPartials } from '../../db/repositories/partialsRepository.js';
import {
	createAgentConfig,
	deleteAgentConfig,
	listAgentConfigs,
	updateAgentConfig,
} from '../../db/repositories/settingsRepository.js';
import { agentConfigs, projects } from '../../db/schema/index.js';
import { protectedProcedure, publicProcedure, router } from '../trpc.js';

async function validatePromptIfPresent(prompt: string | null | undefined) {
	if (!prompt) return;
	const dbPartials = await loadPartials();
	const result = validateTemplate(prompt, dbPartials);
	if (!result.valid) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: `Invalid prompt template: ${result.error}`,
		});
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
				const db = getDb();
				const [project] = await db
					.select({ orgId: projects.orgId })
					.from(projects)
					.where(eq(projects.id, input.projectId));
				if (!project || project.orgId !== ctx.user.orgId) {
					throw new TRPCError({ code: 'NOT_FOUND' });
				}
				return listAgentConfigs({ projectId: input.projectId });
			}
			return listAgentConfigs({ orgId: ctx.user.orgId });
		}),

	create: protectedProcedure
		.input(
			z.object({
				orgId: z.string().nullish(),
				projectId: z.string().nullish(),
				agentType: z.string().min(1),
				model: z.string().nullish(),
				maxIterations: z.number().int().positive().nullish(),
				agentBackend: z.string().nullish(),
				prompt: z.string().nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			// If projectId given, verify ownership
			if (input.projectId) {
				const db = getDb();
				const [project] = await db
					.select({ orgId: projects.orgId })
					.from(projects)
					.where(eq(projects.id, input.projectId));
				if (!project || project.orgId !== ctx.user.orgId) {
					throw new TRPCError({ code: 'NOT_FOUND' });
				}
			}
			await validatePromptIfPresent(input.prompt);
			return createAgentConfig({
				orgId: input.orgId ?? ctx.user.orgId,
				projectId: input.projectId,
				agentType: input.agentType,
				model: input.model,
				maxIterations: input.maxIterations,
				agentBackend: input.agentBackend,
				prompt: input.prompt,
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
				prompt: z.string().nullish(),
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
			// Check org-scoped configs belong to user's org
			if (config.orgId && config.orgId !== ctx.user.orgId) {
				throw new TRPCError({ code: 'NOT_FOUND' });
			}
			// Check project-scoped configs belong to user's org
			if (config.projectId) {
				const [project] = await db
					.select({ orgId: projects.orgId })
					.from(projects)
					.where(eq(projects.id, config.projectId));
				if (!project || project.orgId !== ctx.user.orgId) {
					throw new TRPCError({ code: 'NOT_FOUND' });
				}
			}

			const { id, ...updates } = input;
			await validatePromptIfPresent(updates.prompt);
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
			if (config.orgId && config.orgId !== ctx.user.orgId) {
				throw new TRPCError({ code: 'NOT_FOUND' });
			}
			if (config.projectId) {
				const [project] = await db
					.select({ orgId: projects.orgId })
					.from(projects)
					.where(eq(projects.id, config.projectId));
				if (!project || project.orgId !== ctx.user.orgId) {
					throw new TRPCError({ code: 'NOT_FOUND' });
				}
			}

			await deleteAgentConfig(input.id);
		}),
});
