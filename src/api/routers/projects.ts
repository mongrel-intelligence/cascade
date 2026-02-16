import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../../db/client.js';
import {
	listProjectOverrides,
	removeAgentCredentialOverride,
	removeProjectCredentialOverride,
	setAgentCredentialOverride,
	setProjectCredentialOverride,
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
		return listProjectsForOrg(ctx.user.orgId);
	}),

	// New - returns all columns
	listFull: protectedProcedure.query(async ({ ctx }) => {
		return listProjectsFull(ctx.user.orgId);
	}),

	getById: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
		const project = await getProjectFull(input.id, ctx.user.orgId);
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
			return createProject(ctx.user.orgId, input);
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
			await verifyProjectOwnership(input.id, ctx.user.orgId);
			const { id, ...updates } = input;
			await updateProject(id, ctx.user.orgId, updates);
		}),

	delete: protectedProcedure
		.input(z.object({ id: z.string() }))
		.mutation(async ({ ctx, input }) => {
			await verifyProjectOwnership(input.id, ctx.user.orgId);
			await deleteProject(input.id, ctx.user.orgId);
		}),

	// Integrations
	integrations: router({
		list: protectedProcedure
			.input(z.object({ projectId: z.string() }))
			.query(async ({ ctx, input }) => {
				await verifyProjectOwnership(input.projectId, ctx.user.orgId);
				return listProjectIntegrations(input.projectId);
			}),

		upsert: protectedProcedure
			.input(
				z.object({
					projectId: z.string(),
					type: z.string().min(1),
					config: z.record(z.unknown()),
				}),
			)
			.mutation(async ({ ctx, input }) => {
				await verifyProjectOwnership(input.projectId, ctx.user.orgId);
				await upsertProjectIntegration(input.projectId, input.type, input.config);
			}),

		delete: protectedProcedure
			.input(z.object({ projectId: z.string(), type: z.string() }))
			.mutation(async ({ ctx, input }) => {
				await verifyProjectOwnership(input.projectId, ctx.user.orgId);
				await deleteProjectIntegration(input.projectId, input.type);
			}),
	}),

	// Credential Overrides
	credentialOverrides: router({
		list: protectedProcedure
			.input(z.object({ projectId: z.string() }))
			.query(async ({ ctx, input }) => {
				await verifyProjectOwnership(input.projectId, ctx.user.orgId);
				return listProjectOverrides(input.projectId);
			}),

		set: protectedProcedure
			.input(
				z.object({
					projectId: z.string(),
					envVarKey: z.string(),
					credentialId: z.number(),
				}),
			)
			.mutation(async ({ ctx, input }) => {
				await verifyProjectOwnership(input.projectId, ctx.user.orgId);
				await verifyCredentialOwnership(input.credentialId, ctx.user.orgId);
				await setProjectCredentialOverride(input.projectId, input.envVarKey, input.credentialId);
			}),

		remove: protectedProcedure
			.input(z.object({ projectId: z.string(), envVarKey: z.string() }))
			.mutation(async ({ ctx, input }) => {
				await verifyProjectOwnership(input.projectId, ctx.user.orgId);
				await removeProjectCredentialOverride(input.projectId, input.envVarKey);
			}),

		setAgent: protectedProcedure
			.input(
				z.object({
					projectId: z.string(),
					envVarKey: z.string(),
					agentType: z.string(),
					credentialId: z.number(),
				}),
			)
			.mutation(async ({ ctx, input }) => {
				await verifyProjectOwnership(input.projectId, ctx.user.orgId);
				await verifyCredentialOwnership(input.credentialId, ctx.user.orgId);
				await setAgentCredentialOverride(
					input.projectId,
					input.envVarKey,
					input.agentType,
					input.credentialId,
				);
			}),

		removeAgent: protectedProcedure
			.input(
				z.object({
					projectId: z.string(),
					envVarKey: z.string(),
					agentType: z.string(),
				}),
			)
			.mutation(async ({ ctx, input }) => {
				await verifyProjectOwnership(input.projectId, ctx.user.orgId);
				await removeAgentCredentialOverride(input.projectId, input.envVarKey, input.agentType);
			}),
	}),
});
