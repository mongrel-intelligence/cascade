import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../../db/client.js';
import { listProjectsForOrg } from '../../db/repositories/runsRepository.js';
import {
	createProject,
	deleteProject,
	deleteProjectIntegration,
	getIntegrationByProjectAndCategory,
	getProjectFull,
	listIntegrationCredentials,
	listProjectIntegrations,
	listProjectsFull,
	removeIntegrationCredential,
	setIntegrationCredential,
	updateProject,
	updateProjectIntegrationTriggers,
	upsertProjectIntegration,
} from '../../db/repositories/settingsRepository.js';
import { credentials, projects } from '../../db/schema/index.js';
import { protectedProcedure, router } from '../trpc.js';

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

async function verifyCredentialOwnership(credentialId: number, orgId: string) {
	const db = getDb();
	const [cred] = await db
		.select({ orgId: credentials.orgId })
		.from(credentials)
		.where(eq(credentials.id, credentialId));
	if (!cred || cred.orgId !== orgId) {
		throw new TRPCError({ code: 'NOT_FOUND' });
	}
}

export const projectsRouter = router({
	// Existing - returns id+name for dropdowns
	list: protectedProcedure.query(async ({ ctx }) => {
		return listProjectsForOrg(ctx.effectiveOrgId);
	}),

	// New - returns all columns
	listFull: protectedProcedure.query(async ({ ctx }) => {
		return listProjectsFull(ctx.effectiveOrgId);
	}),

	getById: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
		const project = await getProjectFull(input.id, ctx.effectiveOrgId);
		if (!project) throw new TRPCError({ code: 'NOT_FOUND' });
		return project;
	}),

	create: protectedProcedure
		.input(
			z.object({
				id: z
					.string()
					.min(1)
					.regex(/^[a-z0-9-]+$/),
				name: z.string().min(1),
				repo: z.string().min(1),
				baseBranch: z.string().optional(),
				branchPrefix: z.string().optional(),
				model: z.string().nullish(),
				cardBudgetUsd: z.string().nullish(),
				agentBackend: z.string().nullish(),
				subscriptionCostZero: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return createProject(ctx.effectiveOrgId, input);
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
				cardBudgetUsd: z.string().nullish(),
				agentBackend: z.string().nullish(),
				subscriptionCostZero: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await verifyProjectOwnership(input.id, ctx.effectiveOrgId);
			const { id, ...updates } = input;
			await updateProject(id, ctx.effectiveOrgId, updates);
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
					triggers: z.record(z.unknown()),
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

	// Integration Credentials
	integrationCredentials: router({
		list: protectedProcedure
			.input(z.object({ projectId: z.string(), category: z.enum(['pm', 'scm']) }))
			.query(async ({ ctx, input }) => {
				await verifyProjectOwnership(input.projectId, ctx.effectiveOrgId);
				const integration = await getIntegrationByProjectAndCategory(
					input.projectId,
					input.category,
				);
				if (!integration) return [];
				return listIntegrationCredentials(integration.id);
			}),

		set: protectedProcedure
			.input(
				z.object({
					projectId: z.string(),
					category: z.enum(['pm', 'scm']),
					role: z.string().min(1),
					credentialId: z.number(),
				}),
			)
			.mutation(async ({ ctx, input }) => {
				await verifyProjectOwnership(input.projectId, ctx.effectiveOrgId);
				await verifyCredentialOwnership(input.credentialId, ctx.effectiveOrgId);
				const integration = await getIntegrationByProjectAndCategory(
					input.projectId,
					input.category,
				);
				if (!integration) {
					throw new TRPCError({
						code: 'NOT_FOUND',
						message: `No ${input.category} integration found for project`,
					});
				}
				await setIntegrationCredential(integration.id, input.role, input.credentialId);
			}),

		remove: protectedProcedure
			.input(
				z.object({
					projectId: z.string(),
					category: z.enum(['pm', 'scm']),
					role: z.string().min(1),
				}),
			)
			.mutation(async ({ ctx, input }) => {
				await verifyProjectOwnership(input.projectId, ctx.effectiveOrgId);
				const integration = await getIntegrationByProjectAndCategory(
					input.projectId,
					input.category,
				);
				if (!integration) {
					throw new TRPCError({
						code: 'NOT_FOUND',
						message: `No ${input.category} integration found for project`,
					});
				}
				await removeIntegrationCredential(integration.id, input.role);
			}),
	}),
});
