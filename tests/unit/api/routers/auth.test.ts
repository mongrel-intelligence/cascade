import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TRPCContext } from '../../../../src/api/trpc.js';

const mockListAllOrganizations = vi.fn();

vi.mock('../../../../src/db/repositories/settingsRepository.js', () => ({
	listAllOrganizations: (...args: unknown[]) => mockListAllOrganizations(...args),
}));

import { authRouter } from '../../../../src/api/routers/auth.js';

function createCaller(ctx: TRPCContext) {
	return authRouter.createCaller(ctx);
}

describe('authRouter', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('me', () => {
		it('returns user data from context', async () => {
			const mockUser = {
				id: 'user-1',
				orgId: 'org-1',
				email: 'test@example.com',
				name: 'Test User',
				role: 'admin',
			};
			mockListAllOrganizations.mockResolvedValue([{ id: 'org-1', name: 'Org One' }]);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.me();

			expect(result).toEqual({
				id: 'user-1',
				email: 'test@example.com',
				name: 'Test User',
				role: 'admin',
				orgId: 'org-1',
				effectiveOrgId: 'org-1',
				availableOrgs: [{ id: 'org-1', name: 'Org One' }],
			});
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });

			await expect(caller.me()).rejects.toThrow(TRPCError);
			await expect(caller.me()).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});
	});
});
