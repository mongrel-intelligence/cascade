import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDb } from '../../../helpers/mockDb.js';

vi.mock('../../../../src/db/client.js', () => ({
	getDb: vi.fn(),
}));

import { getDb } from '../../../../src/db/client.js';
import {
	createProject,
	deleteProject,
	getProjectFull,
	listAllProjects,
	listProjectsFull,
	updateProject,
} from '../../../../src/db/repositories/projectsRepository.js';

describe('projectsRepository', () => {
	let mockDb: ReturnType<typeof createMockDb>;

	beforeEach(() => {
		mockDb = createMockDb({ withUpsert: true, withThenable: true });
		vi.mocked(getDb).mockReturnValue(mockDb.db as never);
	});

	describe('listProjectsFull', () => {
		it('queries projects by orgId', async () => {
			const projects = [{ id: 'p1', name: 'Project 1' }];
			mockDb.chain.where.mockResolvedValueOnce(projects);

			const result = await listProjectsFull('org-1');
			expect(result).toEqual(projects);
			expect(mockDb.db.select).toHaveBeenCalledTimes(1);
		});
	});

	describe('listAllProjects', () => {
		it('queries all projects without filter', async () => {
			const projects = [
				{ id: 'p1', name: 'Project 1' },
				{ id: 'p2', name: 'Project 2' },
			];
			mockDb.chain.where.mockResolvedValueOnce(projects);

			const result = await listAllProjects();
			expect(result).toEqual(projects);
			expect(mockDb.db.select).toHaveBeenCalledTimes(1);
			expect(mockDb.chain.where).toHaveBeenCalledWith(expect.anything());
		});
	});

	describe('getProjectFull', () => {
		it('returns project when found with matching org', async () => {
			const project = { id: 'p1', orgId: 'org-1', name: 'Project 1' };
			mockDb.chain.where.mockResolvedValueOnce([project]);

			const result = await getProjectFull('p1', 'org-1');
			expect(result).toEqual(project);
		});

		it('returns null when not found', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await getProjectFull('missing', 'org-1');
			expect(result).toBeNull();
		});
	});

	describe('createProject', () => {
		it('inserts project and returns row', async () => {
			const newProject = { id: 'p1', orgId: 'org-1', name: 'New Project', repo: 'owner/repo' };
			mockDb.chain.returning.mockResolvedValueOnce([newProject]);

			const result = await createProject('org-1', {
				id: 'p1',
				name: 'New Project',
				repo: 'owner/repo',
			});

			expect(result).toEqual(newProject);
			expect(mockDb.db.insert).toHaveBeenCalledTimes(1);
			expect(mockDb.chain.values).toHaveBeenCalledWith(
				expect.objectContaining({
					id: 'p1',
					orgId: 'org-1',
					name: 'New Project',
					repo: 'owner/repo',
					baseBranch: 'main',
					branchPrefix: 'feature/',
					subscriptionCostZero: false,
				}),
			);
		});
	});

	describe('updateProject', () => {
		it('updates project with new values', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await updateProject('p1', 'org-1', { name: 'Updated', model: 'new-model' });

			expect(mockDb.db.update).toHaveBeenCalledTimes(1);
			const setArg = mockDb.chain.set.mock.calls[0][0];
			expect(setArg.name).toBe('Updated');
			expect(setArg.model).toBe('new-model');
			expect(setArg.updatedAt).toBeInstanceOf(Date);
		});
	});

	describe('deleteProject', () => {
		it('deletes project by id and orgId', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await deleteProject('p1', 'org-1');

			expect(mockDb.db.delete).toHaveBeenCalledTimes(1);
		});
	});
});
