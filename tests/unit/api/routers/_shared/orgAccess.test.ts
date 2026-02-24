import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks ---

const mockGetRunById = vi.fn();
vi.mock('../../../../../src/db/repositories/runsRepository.js', () => ({
	getRunById: (...args: unknown[]) => mockGetRunById(...args),
}));

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

import {
	verifyProjectOrgAccess,
	verifyRunOrgAccess,
} from '../../../../../src/api/routers/_shared/orgAccess.js';

function setupDbChain(result: unknown[]) {
	mockDbSelect.mockReturnValue({ from: mockDbFrom });
	mockDbFrom.mockReturnValue({ where: mockDbWhere });
	mockDbWhere.mockResolvedValue(result);
}

describe('verifyProjectOrgAccess', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('does not throw when project belongs to the org', async () => {
		setupDbChain([{ orgId: 'org-1' }]);
		await expect(verifyProjectOrgAccess('project-1', 'org-1')).resolves.toBeUndefined();
	});

	it('throws NOT_FOUND when project does not exist', async () => {
		setupDbChain([]);
		await expect(verifyProjectOrgAccess('project-1', 'org-1')).rejects.toMatchObject({
			code: 'NOT_FOUND',
		});
	});

	it('throws NOT_FOUND when project belongs to a different org', async () => {
		setupDbChain([{ orgId: 'other-org' }]);
		await expect(verifyProjectOrgAccess('project-1', 'org-1')).rejects.toMatchObject({
			code: 'NOT_FOUND',
		});
	});

	it('throws a TRPCError (not a generic error)', async () => {
		setupDbChain([]);
		try {
			await verifyProjectOrgAccess('project-1', 'org-1');
			expect.fail('should have thrown');
		} catch (err) {
			expect(err).toBeInstanceOf(TRPCError);
		}
	});
});

describe('verifyRunOrgAccess', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('throws NOT_FOUND when run does not exist', async () => {
		mockGetRunById.mockResolvedValue(null);
		await expect(verifyRunOrgAccess('run-1', 'org-1')).rejects.toMatchObject({
			code: 'NOT_FOUND',
		});
	});

	it('does not perform org check when run has no projectId', async () => {
		mockGetRunById.mockResolvedValue({ id: 'run-1', projectId: null });
		await expect(verifyRunOrgAccess('run-1', 'org-1')).resolves.toBeUndefined();
		expect(mockDbSelect).not.toHaveBeenCalled();
	});

	it('verifies project org when run has a projectId', async () => {
		mockGetRunById.mockResolvedValue({ id: 'run-1', projectId: 'project-1' });
		setupDbChain([{ orgId: 'org-1' }]);
		await expect(verifyRunOrgAccess('run-1', 'org-1')).resolves.toBeUndefined();
		expect(mockDbSelect).toHaveBeenCalled();
	});

	it('throws NOT_FOUND when run project belongs to different org', async () => {
		mockGetRunById.mockResolvedValue({ id: 'run-1', projectId: 'project-1' });
		setupDbChain([{ orgId: 'other-org' }]);
		await expect(verifyRunOrgAccess('run-1', 'org-1')).rejects.toMatchObject({
			code: 'NOT_FOUND',
		});
	});
});
