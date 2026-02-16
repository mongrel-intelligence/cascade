import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TRPCContext } from '../../../../src/api/trpc.js';

const mockGetOrganization = vi.fn();
const mockUpdateOrganization = vi.fn();

vi.mock('../../../../src/db/repositories/settingsRepository.js', () => ({
	getOrganization: (...args: unknown[]) => mockGetOrganization(...args),
	updateOrganization: (...args: unknown[]) => mockUpdateOrganization(...args),
}));

import { organizationRouter } from '../../../../src/api/routers/organization.js';

function createCaller(ctx: TRPCContext) {
	return organizationRouter.createCaller(ctx);
}

const mockUser = {
	id: 'user-1',
	orgId: 'org-1',
	email: 'test@example.com',
	name: 'Test',
	role: 'admin',
};

describe('organizationRouter', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('get', () => {
		it('returns organization for user orgId', async () => {
			const mockOrg = { id: 'org-1', name: 'My Org' };
			mockGetOrganization.mockResolvedValue(mockOrg);
			const caller = createCaller({ user: mockUser });

			const result = await caller.get();

			expect(mockGetOrganization).toHaveBeenCalledWith('org-1');
			expect(result).toEqual(mockOrg);
		});

		it('returns null when organization not found', async () => {
			mockGetOrganization.mockResolvedValue(null);
			const caller = createCaller({ user: mockUser });

			const result = await caller.get();
			expect(result).toBeNull();
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null });
			await expect(caller.get()).rejects.toThrow(TRPCError);
			await expect(caller.get()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
		});
	});

	describe('update', () => {
		it('updates organization name', async () => {
			mockUpdateOrganization.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockUser });

			await caller.update({ name: 'New Name' });

			expect(mockUpdateOrganization).toHaveBeenCalledWith('org-1', { name: 'New Name' });
		});

		it('rejects empty name', async () => {
			const caller = createCaller({ user: mockUser });
			await expect(caller.update({ name: '' })).rejects.toThrow();
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null });
			await expect(caller.update({ name: 'New' })).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});
	});
});
