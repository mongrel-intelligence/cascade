import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockDbSelect = vi.fn();
const mockDbFrom = vi.fn();
const mockDbWhere = vi.fn();

vi.mock('../../../../../src/db/client.js', () => ({
	getDb: () => ({
		select: mockDbSelect,
	}),
}));

vi.mock('../../../../../src/db/schema/index.js', () => ({
	projects: { id: 'id', orgId: 'org_id' },
}));

import { verifyProjectOrgAccess } from '../../../../../src/api/routers/_shared/projectAccess.js';

describe('verifyProjectOrgAccess', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDbSelect.mockReturnValue({ from: mockDbFrom });
		mockDbFrom.mockReturnValue({ where: mockDbWhere });
	});

	it('resolves without error when project belongs to the given org', async () => {
		mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
		await expect(verifyProjectOrgAccess('project-1', 'org-1')).resolves.toBeUndefined();
	});

	it('throws NOT_FOUND when project belongs to a different org', async () => {
		mockDbWhere.mockResolvedValue([{ orgId: 'other-org' }]);
		await expect(verifyProjectOrgAccess('project-1', 'org-1')).rejects.toMatchObject({
			code: 'NOT_FOUND',
		});
	});

	it('throws NOT_FOUND when project does not exist', async () => {
		mockDbWhere.mockResolvedValue([]);
		await expect(verifyProjectOrgAccess('nonexistent', 'org-1')).rejects.toMatchObject({
			code: 'NOT_FOUND',
		});
	});

	it('throws a TRPCError (not a generic Error)', async () => {
		mockDbWhere.mockResolvedValue([{ orgId: 'other-org' }]);
		await expect(verifyProjectOrgAccess('project-1', 'org-1')).rejects.toBeInstanceOf(TRPCError);
	});
});
