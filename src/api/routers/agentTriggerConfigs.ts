import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
	deleteTriggerConfig,
	getTriggerConfig,
	getTriggerConfigById,
	getTriggerConfigsByProject,
	getTriggerConfigsByProjectAndAgent,
	updateTriggerConfig,
	upsertTriggerConfig,
} from '../../db/repositories/agentTriggerConfigsRepository.js';
import { protectedProcedure, router } from '../trpc.js';
import { verifyProjectOrgAccess } from './_shared/projectAccess.js';

export const agentTriggerConfigsRouter = router({
	/**
	 * List all trigger configs for a project.
	 */
	listByProject: protectedProcedure
		.input(z.object({ projectId: z.string() }))
		.query(async ({ ctx, input }) => {
			await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);
			return getTriggerConfigsByProject(input.projectId);
		}),

	/**
	 * List trigger configs for a specific agent in a project.
	 */
	listByProjectAndAgent: protectedProcedure
		.input(z.object({ projectId: z.string(), agentType: z.string() }))
		.query(async ({ ctx, input }) => {
			await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);
			return getTriggerConfigsByProjectAndAgent(input.projectId, input.agentType);
		}),

	/**
	 * Get a specific trigger config.
	 */
	get: protectedProcedure
		.input(
			z.object({
				projectId: z.string(),
				agentType: z.string(),
				triggerEvent: z.string(),
			}),
		)
		.query(async ({ ctx, input }) => {
			await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);
			return getTriggerConfig(input.projectId, input.agentType, input.triggerEvent);
		}),

	/**
	 * Create or update a trigger config.
	 */
	upsert: protectedProcedure
		.input(
			z.object({
				projectId: z.string(),
				agentType: z.string(),
				triggerEvent: z.string(),
				enabled: z.boolean().optional(),
				parameters: z.record(z.unknown()).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);
			return upsertTriggerConfig({
				projectId: input.projectId,
				agentType: input.agentType,
				triggerEvent: input.triggerEvent,
				enabled: input.enabled,
				parameters: input.parameters,
			});
		}),

	/**
	 * Update an existing trigger config by ID.
	 */
	update: protectedProcedure
		.input(
			z.object({
				id: z.number(),
				enabled: z.boolean().optional(),
				parameters: z.record(z.unknown()).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			// Verify ownership
			const config = await getTriggerConfigById(input.id);
			if (!config) {
				throw new TRPCError({ code: 'NOT_FOUND' });
			}
			await verifyProjectOrgAccess(config.projectId, ctx.effectiveOrgId);

			const result = await updateTriggerConfig(input.id, {
				enabled: input.enabled,
				parameters: input.parameters,
			});
			if (!result) {
				throw new TRPCError({ code: 'NOT_FOUND' });
			}
			return result;
		}),

	/**
	 * Delete a trigger config by ID.
	 */
	delete: protectedProcedure
		.input(z.object({ id: z.number() }))
		.mutation(async ({ ctx, input }) => {
			// Verify ownership
			const config = await getTriggerConfigById(input.id);
			if (!config) {
				throw new TRPCError({ code: 'NOT_FOUND' });
			}
			await verifyProjectOrgAccess(config.projectId, ctx.effectiveOrgId);

			await deleteTriggerConfig(input.id);
		}),

	/**
	 * Bulk update trigger configs for a project.
	 * This is optimized for the dashboard where we update multiple triggers at once.
	 */
	bulkUpsert: protectedProcedure
		.input(
			z.object({
				projectId: z.string(),
				configs: z.array(
					z.object({
						agentType: z.string(),
						triggerEvent: z.string(),
						enabled: z.boolean().optional(),
						parameters: z.record(z.unknown()).optional(),
					}),
				),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await verifyProjectOrgAccess(input.projectId, ctx.effectiveOrgId);

			const results = await Promise.all(
				input.configs.map((config) =>
					upsertTriggerConfig({
						projectId: input.projectId,
						agentType: config.agentType,
						triggerEvent: config.triggerEvent,
						enabled: config.enabled,
						parameters: config.parameters,
					}),
				),
			);
			return results;
		}),
});
