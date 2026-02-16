import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../../db/client.js';
import {
	createCredential,
	deleteCredential,
	listOrgCredentials,
	updateCredential,
} from '../../db/repositories/credentialsRepository.js';
import { credentials } from '../../db/schema/index.js';
import { protectedProcedure, router } from '../trpc.js';

function maskValue(value: string): string {
	if (value.length <= 4) return '****';
	return `****${value.slice(-4)}`;
}

export const credentialsRouter = router({
	list: protectedProcedure.query(async ({ ctx }) => {
		const rows = await listOrgCredentials(ctx.user.orgId);
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
				description: z.string().optional(),
				isDefault: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return createCredential({
				orgId: ctx.user.orgId,
				name: input.name,
				envVarKey: input.envVarKey,
				value: input.value,
				description: input.description,
				isDefault: input.isDefault,
			});
		}),

	update: protectedProcedure
		.input(
			z.object({
				id: z.number(),
				name: z.string().min(1).optional(),
				value: z.string().min(1).optional(),
				description: z.string().optional(),
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
			if (!cred || cred.orgId !== ctx.user.orgId) {
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
			if (!cred || cred.orgId !== ctx.user.orgId) {
				throw new TRPCError({ code: 'NOT_FOUND' });
			}

			await deleteCredential(input.id);
		}),
});
