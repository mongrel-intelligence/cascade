import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';
import { authRouter } from '../../../../src/api/routers/auth.js';
import type { TRPCContext } from '../../../../src/api/trpc.js';

function createCaller(ctx: TRPCContext) {
	return authRouter.createCaller(ctx);
}

describe('authRouter', () => {
	describe('me', () => {
		it('returns user data from context', async () => {
			const mockUser = {
				id: 'user-1',
				orgId: 'org-1',
				email: 'test@example.com',
				name: 'Test User',
				role: 'admin',
			};
			const caller = createCaller({ user: mockUser });

			const result = await caller.me();

			expect(result).toEqual({
				id: 'user-1',
				email: 'test@example.com',
				name: 'Test User',
				role: 'admin',
				orgId: 'org-1',
			});
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null });

			await expect(caller.me()).rejects.toThrow(TRPCError);
			await expect(caller.me()).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});
	});
});
