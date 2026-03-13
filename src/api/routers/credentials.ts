import { Octokit } from '@octokit/rest';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../../db/client.js';
import { decryptCredential } from '../../db/crypto.js';
import {
	createCredential,
	deleteCredential,
	listAllCredentials,
	listOrgCredentials,
	updateCredential,
} from '../../db/repositories/credentialsRepository.js';
import { credentials } from '../../db/schema/index.js';
import { protectedProcedure, router, superAdminProcedure } from '../trpc.js';

function maskValue(value: string): string {
	if (value.length <= 4) return '****';
	return `****${value.slice(-4)}`;
}

export const credentialsRouter = router({
	list: protectedProcedure.query(async ({ ctx }) => {
		const rows = await listOrgCredentials(ctx.effectiveOrgId);
		return rows.map((row) => ({
			...row,
			value: maskValue(row.value),
		}));
	}),

	listAll: superAdminProcedure.query(async () => {
		const rows = await listAllCredentials();
		return rows.map((row) => ({
			...row,
			value: maskValue(row.value),
		}));
	}),

	create: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1),
				envVarKey: z.string().regex(/^[A-Z_][A-Z0-9_]*$/),
				value: z.string().min(1),
				isDefault: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return createCredential({
				orgId: ctx.effectiveOrgId,
				name: input.name,
				envVarKey: input.envVarKey,
				value: input.value,
				isDefault: input.isDefault,
			});
		}),

	update: protectedProcedure
		.input(
			z.object({
				id: z.number(),
				name: z.string().min(1).optional(),
				value: z.string().min(1).optional(),
				isDefault: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			// Verify ownership
			const db = getDb();
			const [cred] = await db
				.select({ orgId: credentials.orgId })
				.from(credentials)
				.where(eq(credentials.id, input.id));

			if (!cred) {
				throw new TRPCError({ code: 'NOT_FOUND' });
			}

			if (cred.orgId !== ctx.effectiveOrgId && ctx.user.role !== 'superadmin') {
				throw new TRPCError({ code: 'NOT_FOUND' });
			}

			const { id, ...updates } = input;
			await updateCredential(id, updates);
		}),

	delete: protectedProcedure
		.input(z.object({ id: z.number() }))
		.mutation(async ({ ctx, input }) => {
			// Verify ownership
			const db = getDb();
			const [cred] = await db
				.select({ orgId: credentials.orgId })
				.from(credentials)
				.where(eq(credentials.id, input.id));

			if (!cred) {
				throw new TRPCError({ code: 'NOT_FOUND' });
			}

			if (cred.orgId !== ctx.effectiveOrgId && ctx.user.role !== 'superadmin') {
				throw new TRPCError({ code: 'NOT_FOUND' });
			}

			await deleteCredential(input.id);
		}),

	verifyGithubIdentity: protectedProcedure
		.input(z.object({ credentialId: z.number() }))
		.mutation(async ({ ctx, input }) => {
			const db = getDb();
			const [cred] = await db
				.select({ orgId: credentials.orgId, value: credentials.value })
				.from(credentials)
				.where(eq(credentials.id, input.credentialId));

			if (!cred) {
				throw new TRPCError({ code: 'NOT_FOUND' });
			}

			if (cred.orgId !== ctx.effectiveOrgId && ctx.user.role !== 'superadmin') {
				throw new TRPCError({ code: 'NOT_FOUND' });
			}

			try {
				const token = decryptCredential(cred.value, cred.orgId);
				const octokit = new Octokit({ auth: token });
				const { data } = await octokit.users.getAuthenticated();
				return { login: data.login, avatarUrl: data.avatar_url };
			} catch (err) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: `Failed to verify GitHub identity: ${err instanceof Error ? err.message : String(err)}`,
				});
			}
		}),
});
