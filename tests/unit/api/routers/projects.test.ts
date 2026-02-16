import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TRPCContext } from '../../../../src/api/trpc.js';

const mockListProjectsForOrg = vi.fn();

vi.mock('../../../../src/db/repositories/runsRepository.js', () => ({
	listProjectsForOrg: (...args: unknown[]) => mockListProjectsForOrg(...args),
}));

import { projectsRouter } from '../../../../src/api/routers/projects.js';

function createCaller(ctx: TRPCContext) {
	return projectsRouter.createCaller(ctx);
}

const mockUser = {
	id: 'user-1',
	orgId: 'org-1',
	email: 'test@example.com',
	name: 'Test',
	role: 'admin',
};

describe('projectsRouter', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('list', () => {
		it('calls listProjectsForOrg with orgId from user context', async () => {
			mockListProjectsForOrg.mockResolvedValue([
				{ id: 'p1', name: 'Project 1' },
				{ id: 'p2', name: 'Project 2' },
			]);
			const caller = createCaller({ user: mockUser });

			const result = await caller.list();

			expect(mockListProjectsForOrg).toHaveBeenCalledWith('org-1');
			expect(result).toEqual([
				{ id: 'p1', name: 'Project 1' },
				{ id: 'p2', name: 'Project 2' },
			]);
		});

		it('returns empty array when org has no projects', async () => {
			mockListProjectsForOrg.mockResolvedValue([]);
			const caller = createCaller({ user: mockUser });

			const result = await caller.list();
			expect(result).toEqual([]);
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null });

			await expect(caller.list()).rejects.toThrow(TRPCError);
			await expect(caller.list()).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});
	});
});
