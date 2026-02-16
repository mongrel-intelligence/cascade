import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';
import { type TRPCContext, protectedProcedure, router } from '../../../src/api/trpc.js';

// Create a minimal test router
const testRouter = router({
	whoami: protectedProcedure.query(({ ctx }) => ctx.user),
});

function createCaller(ctx: TRPCContext) {
	return testRouter.createCaller(ctx);
}

describe('tRPC protectedProcedure', () => {
	it('throws UNAUTHORIZED when ctx.user is null', async () => {
		const caller = createCaller({ user: null });

		await expect(caller.whoami()).rejects.toThrow(TRPCError);
		await expect(caller.whoami()).rejects.toMatchObject({
			code: 'UNAUTHORIZED',
		});
	});

	it('passes through when ctx.user is present', async () => {
		const mockUser = {
			id: 'user-1',
			orgId: 'org-1',
			email: 'test@example.com',
			name: 'Test',
			role: 'admin',
		};
		const caller = createCaller({ user: mockUser });

		const result = await caller.whoami();
		expect(result).toEqual(mockUser);
	});
});
