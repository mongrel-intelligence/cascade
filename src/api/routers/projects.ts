import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { EngineSettingsSchema } from '../../config/engineSettings.js';
import { getDb } from '../../db/client.js';
import {
	deleteProjectCredential,
	listProjectCredentials,
	writeProjectCredential,
} from '../../db/repositories/credentialsRepository.js';
import { listProjectsForOrg } from '../../db/repositories/runsRepository.js';
import {
	createProject,
	deleteProject,
	deleteProjectIntegration,
	getProjectFull,
	listProjectIntegrations,
	listProjectsFull,
	updateProject,
	updateProjectIntegrationTriggers,
	upsertProjectIntegration,
} from '../../db/repositories/settingsRepository.js';
import { projects } from '../../db/schema/index.js';
import { protectedProcedure, router, superAdminProcedure } from '../trpc.js';

async function verifyProjectOwnership(projectId: string, orgId: string) {
	const db = getDb();
	const [project] = await db
		.select({ orgId: projects.orgId })
		.from(projects)
		.where(eq(projects.id, projectId));
	if (!project || project.orgId !== orgId) {
		throw new TRPCError({ code: 'NOT_FOUND' });
	}
}

function serializeProject<T extends { agentEngineSettings?: unknown }>(
	project: T,
): Omit<T, 'agentEngineSettings'> & { engineSettings: T['agentEngineSettings'] | null } {
	const { agentEngineSettings, ...rest } = project;
	return {
		...rest,
		engineSettings: (agentEngineSettings ?? null) as T['agentEngineSettings'] | null,
	};
}

export const projectsRouter = router({
	// Existing - returns id+name for dropdowns
	list: protectedProcedure.query(async ({ ctx }) => {
		return listProjectsForOrg(ctx.effectiveOrgId);
	}),

	listAll: superAdminProcedure.query(async () => {
		const db = getDb();
		return db.select({ id: projects.id, name: projects.name }).from(projects);
	}),

	// New - returns all columns
	listFull: protectedProcedure.query(async ({ ctx }) => {
		return (await listProjectsFull(ctx.effectiveOrgId)).map(serializeProject);
	}),

	getById: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
		const project = await getProjectFull(input.id, ctx.effectiveOrgId);
		if (!project) throw new TRPCError({ code: 'NOT_FOUND' });
		return serializeProject(project);
	}),

	create: protectedProcedure
		.input(
			z.object({
				id: z
					.string()
					.min(1)
					.regex(/^[a-z0-9-]+$/),
				name: z.string().min(1),
				repo: z.string().min(1).optional(),
				baseBranch: z.string().optional(),
				branchPrefix: z.string().optional(),
				model: z.string().nullish(),
				maxIterations: z.number().int().positive().nullish(),
				watchdogTimeoutMs: z.number().int().positive().nullish(),
				workItemBudgetUsd: z.string().nullish(),
				agentEngine: z.string().nullish(),
				engineSettings: EngineSettingsSchema.nullish(),
				progressModel: z.string().nullish(),
				progressIntervalMinutes: z.string().nullish(),
				runLinksEnabled: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return createProject(ctx.effectiveOrgId, {
				...input,
				...(input.agentEngine !== undefined ? { agentEngine: input.agentEngine } : {}),
				...(input.engineSettings !== undefined ? { engineSettings: input.engineSettings } : {}),
			});
		}),

	update: protectedProcedure
		.input(
			z.object({
				id: z.string(),
				name: z.string().min(1).optional(),
				repo: z.string().min(1).optional(),
				baseBranch: z.string().optional(),
				branchPrefix: z.string().optional(),
				model: z.string().nullish(),
				maxIterations: z.number().int().positive().nullish(),
				watchdogTimeoutMs: z.number().int().positive().nullish(),
				workItemBudgetUsd: z.string().nullish(),
				agentEngine: z.string().nullish(),
				engineSettings: EngineSettingsSchema.nullish(),
				progressModel: z.string().nullish(),
				progressIntervalMinutes: z.string().nullish(),
				runLinksEnabled: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await verifyProjectOwnership(input.id, ctx.effectiveOrgId);
			const { id, ...updates } = input;
			await updateProject(id, ctx.effectiveOrgId, {
				...updates,
				...(input.agentEngine !== undefined ? { agentEngine: input.agentEngine } : {}),
				...(input.engineSettings !== undefined ? { engineSettings: input.engineSettings } : {}),
			});
		}),

	delete: protectedProcedure
		.input(z.object({ id: z.string() }))
		.mutation(async ({ ctx, input }) => {
			await verifyProjectOwnership(input.id, ctx.effectiveOrgId);
			await deleteProject(input.id, ctx.effectiveOrgId);
		}),

	// Integrations
	integrations: router({
		list: protectedProcedure
			.input(z.object({ projectId: z.string() }))
			.query(async ({ ctx, input }) => {
				await verifyProjectOwnership(input.projectId, ctx.effectiveOrgId);
				return listProjectIntegrations(input.projectId);
			}),

		upsert: protectedProcedure
			.input(
				z.object({
					projectId: z.string(),
					category: z.enum(['pm', 'scm']),
					provider: z.string().min(1),
					config: z.record(z.unknown()),
					triggers: z.record(z.boolean()).optional(),
				}),
			)
			.mutation(async ({ ctx, input }) => {
				await verifyProjectOwnership(input.projectId, ctx.effectiveOrgId);
				return upsertProjectIntegration(
					input.projectId,
					input.category,
					input.provider,
					input.config,
					input.triggers,
				);
			}),

		updateTriggers: protectedProcedure
			.input(
				z.object({
					projectId: z.string(),
					category: z.enum(['pm', 'scm']),
					triggers: z.record(z.union([z.boolean(), z.string().nullable(), z.record(z.boolean())])),
				}),
			)
			.mutation(async ({ ctx, input }) => {
				await verifyProjectOwnership(input.projectId, ctx.effectiveOrgId);
				await updateProjectIntegrationTriggers(input.projectId, input.category, input.triggers);
			}),

		delete: protectedProcedure
			.input(z.object({ projectId: z.string(), category: z.enum(['pm', 'scm']) }))
			.mutation(async ({ ctx, input }) => {
				await verifyProjectOwnership(input.projectId, ctx.effectiveOrgId);
				await deleteProjectIntegration(input.projectId, input.category);
			}),
	}),

	// Project-scoped credentials (project_credentials table)
	credentials: router({
		/**
		 * List masked metadata for all project-scoped credentials.
		 * Never returns plaintext values — only masked last-4-chars preview.
		 */
		list: protectedProcedure
			.input(z.object({ projectId: z.string() }))
			.query(async ({ ctx, input }) => {
				await verifyProjectOwnership(input.projectId, ctx.effectiveOrgId);
				const rows = await listProjectCredentials(input.projectId);
				return rows.map((row) => ({
					envVarKey: row.envVarKey,
					name: row.name,
					isConfigured: true,
					maskedValue: row.value.length <= 4 ? '****' : `****${row.value.slice(-4)}`,
				}));
			}),

		/**
		 * Upsert a project-scoped credential (write-only — never exposes plaintext).
		 */
		set: protectedProcedure
			.input(
				z.object({
					projectId: z.string(),
					envVarKey: z.string().regex(/^[A-Z_][A-Z0-9_]*$/),
					value: z.string().min(1),
					name: z.string().optional(),
				}),
			)
			.mutation(async ({ ctx, input }) => {
				await verifyProjectOwnership(input.projectId, ctx.effectiveOrgId);
				await writeProjectCredential(
					input.projectId,
					input.envVarKey,
					input.value,
					input.name ?? null,
				);
			}),

		/**
		 * Delete a project-scoped credential.
		 */
		delete: protectedProcedure
			.input(
				z.object({
					projectId: z.string(),
					envVarKey: z.string().min(1),
				}),
			)
			.mutation(async ({ ctx, input }) => {
				await verifyProjectOwnership(input.projectId, ctx.effectiveOrgId);
				await deleteProjectCredential(input.projectId, input.envVarKey);
			}),
	}),
});
