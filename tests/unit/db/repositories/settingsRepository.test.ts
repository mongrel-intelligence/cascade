import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/db/client.js', () => ({
	getDb: vi.fn(),
}));

import { getDb } from '../../../../src/db/client.js';
import {
	createAgentConfig,
	createProject,
	deleteAgentConfig,
	deleteProject,
	deleteProjectIntegration,
	getCascadeDefaults,
	getOrganization,
	getProjectFull,
	listAgentConfigs,
	listProjectIntegrations,
	listProjectsFull,
	updateAgentConfig,
	updateOrganization,
	updateProject,
	upsertCascadeDefaults,
	upsertProjectIntegration,
} from '../../../../src/db/repositories/settingsRepository.js';

function createMockDb() {
	const chain: Record<string, ReturnType<typeof vi.fn>> = {};

	chain.where = vi.fn().mockResolvedValue([]);
	chain.returning = vi.fn().mockResolvedValue([]);
	chain.limit = vi.fn().mockReturnValue(chain);

	chain.innerJoin = vi.fn().mockReturnValue({ where: chain.where });
	chain.from = vi.fn().mockReturnValue({
		where: chain.where,
		innerJoin: chain.innerJoin,
		limit: chain.limit,
	});
	chain.set = vi.fn().mockReturnValue({ where: chain.where });
	chain.values = vi.fn().mockReturnValue({
		returning: chain.returning,
	});

	// Make chain itself thenable for queries without .where() terminal
	// biome-ignore lint/suspicious/noThenProperty: intentional thenable mock for Drizzle query chains
	chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve([]).then(resolve);

	const db = {
		select: vi.fn().mockReturnValue({ from: chain.from }),
		insert: vi.fn().mockReturnValue({ values: chain.values }),
		update: vi.fn().mockReturnValue({ set: chain.set }),
		delete: vi.fn().mockReturnValue({ where: chain.where }),
	};

	return { db, chain };
}

describe('settingsRepository', () => {
	let mockDb: ReturnType<typeof createMockDb>;

	beforeEach(() => {
		mockDb = createMockDb();
		vi.mocked(getDb).mockReturnValue(mockDb.db as never);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	// ============================================================================
	// Organizations
	// ============================================================================

	describe('getOrganization', () => {
		it('returns organization when found', async () => {
			mockDb.chain.where.mockResolvedValueOnce([{ id: 'org-1', name: 'My Org' }]);

			const result = await getOrganization('org-1');
			expect(result).toEqual({ id: 'org-1', name: 'My Org' });
		});

		it('returns null when not found', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await getOrganization('missing');
			expect(result).toBeNull();
		});
	});

	describe('updateOrganization', () => {
		it('updates organization name', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await updateOrganization('org-1', { name: 'New Name' });

			expect(mockDb.db.update).toHaveBeenCalledTimes(1);
			expect(mockDb.chain.set).toHaveBeenCalledWith({ name: 'New Name' });
		});
	});

	// ============================================================================
	// Cascade Defaults
	// ============================================================================

	describe('getCascadeDefaults', () => {
		it('returns defaults when found', async () => {
			const defaults = { orgId: 'org-1', model: 'claude-sonnet-4-5-20250929', maxIterations: 20 };
			mockDb.chain.where.mockResolvedValueOnce([defaults]);

			const result = await getCascadeDefaults('org-1');
			expect(result).toEqual(defaults);
		});

		it('returns null when not found', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await getCascadeDefaults('missing');
			expect(result).toBeNull();
		});
	});

	describe('upsertCascadeDefaults', () => {
		it('inserts when no existing defaults', async () => {
			// getCascadeDefaults returns null
			mockDb.chain.where.mockResolvedValueOnce([]);

			await upsertCascadeDefaults('org-1', { model: 'test-model' });

			expect(mockDb.db.insert).toHaveBeenCalledTimes(1);
			expect(mockDb.chain.values).toHaveBeenCalledWith(
				expect.objectContaining({ orgId: 'org-1', model: 'test-model' }),
			);
		});

		it('updates when existing defaults found', async () => {
			// getCascadeDefaults returns existing row
			mockDb.chain.where.mockResolvedValueOnce([{ orgId: 'org-1', model: 'old-model' }]);
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await upsertCascadeDefaults('org-1', { model: 'new-model' });

			expect(mockDb.db.update).toHaveBeenCalledTimes(1);
			expect(mockDb.chain.set).toHaveBeenCalledWith(
				expect.objectContaining({ model: 'new-model' }),
			);
		});
	});

	// ============================================================================
	// Projects
	// ============================================================================

	describe('listProjectsFull', () => {
		it('queries projects by orgId', async () => {
			const projects = [{ id: 'p1', name: 'Project 1' }];
			mockDb.chain.where.mockResolvedValueOnce(projects);

			const result = await listProjectsFull('org-1');
			expect(result).toEqual(projects);
			expect(mockDb.db.select).toHaveBeenCalledTimes(1);
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

	// ============================================================================
	// Project Integrations
	// ============================================================================

	describe('listProjectIntegrations', () => {
		it('returns integrations for project', async () => {
			const integrations = [
				{ id: 1, projectId: 'p1', category: 'pm', provider: 'trello', config: {}, triggers: {} },
			];
			mockDb.chain.where.mockResolvedValueOnce(integrations);

			const result = await listProjectIntegrations('p1');
			expect(result).toEqual(integrations);
		});
	});

	describe('upsertProjectIntegration', () => {
		it('deletes then inserts integration', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined); // delete

			await upsertProjectIntegration('p1', 'pm', 'trello', { boardId: 'abc' }, {});

			expect(mockDb.db.delete).toHaveBeenCalledTimes(1);
			expect(mockDb.db.insert).toHaveBeenCalledTimes(1);
			expect(mockDb.chain.values).toHaveBeenCalledWith({
				projectId: 'p1',
				category: 'pm',
				provider: 'trello',
				config: { boardId: 'abc' },
				triggers: {},
			});
		});

		it('preserves existing triggers when triggers not provided', async () => {
			// Mock getIntegrationByProjectAndCategory to return existing integration with triggers
			mockDb.chain.where.mockResolvedValueOnce([
				{
					id: 1,
					projectId: 'p1',
					category: 'pm',
					provider: 'trello',
					config: {},
					triggers: { cardMovedToBriefing: true, cardMovedToPlanning: false },
				},
			]); // getIntegrationByProjectAndCategory
			mockDb.chain.where.mockResolvedValueOnce(undefined); // delete

			await upsertProjectIntegration('p1', 'pm', 'trello', { boardId: 'xyz' });

			expect(mockDb.db.select).toHaveBeenCalledTimes(1); // getIntegrationByProjectAndCategory
			expect(mockDb.db.delete).toHaveBeenCalledTimes(1);
			expect(mockDb.db.insert).toHaveBeenCalledTimes(1);
			expect(mockDb.chain.values).toHaveBeenCalledWith({
				projectId: 'p1',
				category: 'pm',
				provider: 'trello',
				config: { boardId: 'xyz' },
				triggers: { cardMovedToBriefing: true, cardMovedToPlanning: false },
			});
		});
	});

	describe('deleteProjectIntegration', () => {
		it('deletes integration by projectId and type', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await deleteProjectIntegration('p1', 'trello');

			expect(mockDb.db.delete).toHaveBeenCalledTimes(1);
		});
	});

	// ============================================================================
	// Agent Configs
	// ============================================================================

	describe('listAgentConfigs', () => {
		it('returns all configs when no filter', async () => {
			const configs = [{ id: 1, agentType: 'impl' }];
			// No where clause → thenable chain resolves
			const fromMock = vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue(configs),
				// biome-ignore lint/suspicious/noThenProperty: intentional thenable mock for Drizzle query chains
				then: (resolve: (v: unknown) => unknown) => Promise.resolve(configs).then(resolve),
			});
			mockDb.db.select.mockReturnValue({ from: fromMock });

			const result = await listAgentConfigs();
			expect(result).toEqual(configs);
		});

		it('filters by projectId when provided', async () => {
			const configs = [{ id: 2, agentType: 'review', projectId: 'p1' }];
			mockDb.chain.where.mockResolvedValueOnce(configs);

			const result = await listAgentConfigs({ projectId: 'p1' });
			expect(result).toEqual(configs);
		});

		it('filters to non-project configs when orgId provided', async () => {
			const configs = [{ id: 3, agentType: 'impl', orgId: 'org-1' }];
			mockDb.chain.where.mockResolvedValueOnce(configs);

			const result = await listAgentConfigs({ orgId: 'org-1' });
			expect(result).toEqual(configs);
		});
	});

	describe('createAgentConfig', () => {
		it('inserts config and returns id', async () => {
			mockDb.chain.returning.mockResolvedValueOnce([{ id: 42 }]);

			const result = await createAgentConfig({
				orgId: 'org-1',
				agentType: 'implementation',
				model: 'test-model',
				maxIterations: 20,
			});

			expect(result).toEqual({ id: 42 });
			expect(mockDb.chain.values).toHaveBeenCalledWith(
				expect.objectContaining({
					orgId: 'org-1',
					projectId: null,
					agentType: 'implementation',
					model: 'test-model',
					maxIterations: 20,
				}),
			);
		});
	});

	describe('updateAgentConfig', () => {
		it('updates config fields', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await updateAgentConfig(42, { model: 'new-model', maxIterations: 30 });

			expect(mockDb.db.update).toHaveBeenCalledTimes(1);
			const setArg = mockDb.chain.set.mock.calls[0][0];
			expect(setArg.model).toBe('new-model');
			expect(setArg.maxIterations).toBe(30);
			expect(setArg.updatedAt).toBeInstanceOf(Date);
		});
	});

	describe('deleteAgentConfig', () => {
		it('deletes config by id', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await deleteAgentConfig(42);

			expect(mockDb.db.delete).toHaveBeenCalledTimes(1);
		});
	});
});
