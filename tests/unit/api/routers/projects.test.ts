import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TRPCContext } from '../../../../src/api/trpc.js';

const mockListProjectsForOrg = vi.fn();

vi.mock('../../../../src/db/repositories/runsRepository.js', () => ({
	listProjectsForOrg: (...args: unknown[]) => mockListProjectsForOrg(...args),
}));

const mockListProjectsFull = vi.fn();
const mockGetProjectFull = vi.fn();
const mockCreateProject = vi.fn();
const mockUpdateProject = vi.fn();
const mockDeleteProject = vi.fn();
const mockListProjectIntegrations = vi.fn();
const mockUpsertProjectIntegration = vi.fn();
const mockDeleteProjectIntegration = vi.fn();

vi.mock('../../../../src/db/repositories/settingsRepository.js', () => ({
	listProjectsFull: (...args: unknown[]) => mockListProjectsFull(...args),
	getProjectFull: (...args: unknown[]) => mockGetProjectFull(...args),
	createProject: (...args: unknown[]) => mockCreateProject(...args),
	updateProject: (...args: unknown[]) => mockUpdateProject(...args),
	deleteProject: (...args: unknown[]) => mockDeleteProject(...args),
	listProjectIntegrations: (...args: unknown[]) => mockListProjectIntegrations(...args),
	upsertProjectIntegration: (...args: unknown[]) => mockUpsertProjectIntegration(...args),
	deleteProjectIntegration: (...args: unknown[]) => mockDeleteProjectIntegration(...args),
}));

const mockListProjectOverrides = vi.fn();
const mockSetProjectCredentialOverride = vi.fn();
const mockRemoveProjectCredentialOverride = vi.fn();
const mockSetAgentCredentialOverride = vi.fn();
const mockRemoveAgentCredentialOverride = vi.fn();

vi.mock('../../../../src/db/repositories/credentialsRepository.js', () => ({
	listProjectOverrides: (...args: unknown[]) => mockListProjectOverrides(...args),
	setProjectCredentialOverride: (...args: unknown[]) => mockSetProjectCredentialOverride(...args),
	removeProjectCredentialOverride: (...args: unknown[]) =>
		mockRemoveProjectCredentialOverride(...args),
	setAgentCredentialOverride: (...args: unknown[]) => mockSetAgentCredentialOverride(...args),
	removeAgentCredentialOverride: (...args: unknown[]) => mockRemoveAgentCredentialOverride(...args),
}));

// Mock getDb for ownership checks
const mockDbSelect = vi.fn();
const mockDbFrom = vi.fn();
const mockDbWhere = vi.fn();

vi.mock('../../../../src/db/client.js', () => ({
	getDb: () => ({
		select: mockDbSelect,
	}),
}));

vi.mock('../../../../src/db/schema/index.js', () => ({
	credentials: { id: 'id', orgId: 'org_id' },
	projects: { id: 'id', orgId: 'org_id' },
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
		mockDbSelect.mockReturnValue({ from: mockDbFrom });
		mockDbFrom.mockReturnValue({ where: mockDbWhere });
	});

	// ============================================================================
	// Existing list procedure
	// ============================================================================

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

	// ============================================================================
	// New CRUD procedures
	// ============================================================================

	describe('listFull', () => {
		it('returns all project columns', async () => {
			const projects = [{ id: 'p1', name: 'Project 1', repo: 'owner/repo1', baseBranch: 'main' }];
			mockListProjectsFull.mockResolvedValue(projects);
			const caller = createCaller({ user: mockUser });

			const result = await caller.listFull();

			expect(mockListProjectsFull).toHaveBeenCalledWith('org-1');
			expect(result).toEqual(projects);
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null });
			await expect(caller.listFull()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
		});
	});

	describe('getById', () => {
		it('returns project when found', async () => {
			const project = { id: 'p1', orgId: 'org-1', name: 'Project 1' };
			mockGetProjectFull.mockResolvedValue(project);
			const caller = createCaller({ user: mockUser });

			const result = await caller.getById({ id: 'p1' });

			expect(mockGetProjectFull).toHaveBeenCalledWith('p1', 'org-1');
			expect(result).toEqual(project);
		});

		it('throws NOT_FOUND when project does not exist', async () => {
			mockGetProjectFull.mockResolvedValue(null);
			const caller = createCaller({ user: mockUser });

			await expect(caller.getById({ id: 'missing' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});
	});

	describe('create', () => {
		it('creates project with required fields', async () => {
			const created = { id: 'my-project', orgId: 'org-1', name: 'My Project', repo: 'owner/repo' };
			mockCreateProject.mockResolvedValue(created);
			const caller = createCaller({ user: mockUser });

			const result = await caller.create({
				id: 'my-project',
				name: 'My Project',
				repo: 'owner/repo',
			});

			expect(mockCreateProject).toHaveBeenCalledWith('org-1', {
				id: 'my-project',
				name: 'My Project',
				repo: 'owner/repo',
			});
			expect(result).toEqual(created);
		});

		it('rejects invalid id format', async () => {
			const caller = createCaller({ user: mockUser });
			await expect(
				caller.create({ id: 'INVALID ID!', name: 'X', repo: 'owner/repo' }),
			).rejects.toThrow();
		});

		it('rejects empty name', async () => {
			const caller = createCaller({ user: mockUser });
			await expect(
				caller.create({ id: 'valid-id', name: '', repo: 'owner/repo' }),
			).rejects.toThrow();
		});
	});

	describe('update', () => {
		it('updates project after verifying ownership', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
			mockUpdateProject.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockUser });

			await caller.update({ id: 'p1', name: 'Updated Name', model: 'new-model' });

			expect(mockUpdateProject).toHaveBeenCalledWith('p1', 'org-1', {
				name: 'Updated Name',
				model: 'new-model',
			});
		});

		it('throws NOT_FOUND when project belongs to different org', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'different-org' }]);
			const caller = createCaller({ user: mockUser });

			await expect(caller.update({ id: 'p1', name: 'X' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
			expect(mockUpdateProject).not.toHaveBeenCalled();
		});
	});

	describe('delete', () => {
		it('deletes project after verifying ownership', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
			mockDeleteProject.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockUser });

			await caller.delete({ id: 'p1' });

			expect(mockDeleteProject).toHaveBeenCalledWith('p1', 'org-1');
		});

		it('throws NOT_FOUND when project belongs to different org', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'different-org' }]);
			const caller = createCaller({ user: mockUser });

			await expect(caller.delete({ id: 'p1' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
			expect(mockDeleteProject).not.toHaveBeenCalled();
		});
	});

	// ============================================================================
	// Integrations sub-router
	// ============================================================================

	describe('integrations', () => {
		describe('list', () => {
			it('lists integrations after verifying ownership', async () => {
				mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
				const integrations = [{ id: 1, type: 'trello', config: { boardId: 'abc' } }];
				mockListProjectIntegrations.mockResolvedValue(integrations);
				const caller = createCaller({ user: mockUser });

				const result = await caller.integrations.list({ projectId: 'p1' });

				expect(result).toEqual(integrations);
			});

			it('throws NOT_FOUND when project not owned', async () => {
				mockDbWhere.mockResolvedValue([{ orgId: 'other-org' }]);
				const caller = createCaller({ user: mockUser });

				await expect(caller.integrations.list({ projectId: 'p1' })).rejects.toMatchObject({
					code: 'NOT_FOUND',
				});
			});
		});

		describe('upsert', () => {
			it('upserts integration after verifying ownership', async () => {
				mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
				mockUpsertProjectIntegration.mockResolvedValue(undefined);
				const caller = createCaller({ user: mockUser });

				await caller.integrations.upsert({
					projectId: 'p1',
					type: 'trello',
					config: { boardId: 'abc123' },
				});

				expect(mockUpsertProjectIntegration).toHaveBeenCalledWith('p1', 'trello', {
					boardId: 'abc123',
				});
			});
		});

		describe('delete', () => {
			it('deletes integration after verifying ownership', async () => {
				mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
				mockDeleteProjectIntegration.mockResolvedValue(undefined);
				const caller = createCaller({ user: mockUser });

				await caller.integrations.delete({ projectId: 'p1', type: 'trello' });

				expect(mockDeleteProjectIntegration).toHaveBeenCalledWith('p1', 'trello');
			});
		});
	});

	// ============================================================================
	// Credential Overrides sub-router
	// ============================================================================

	describe('credentialOverrides', () => {
		describe('list', () => {
			it('lists overrides after verifying ownership', async () => {
				mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
				const overrides = [
					{ envVarKey: 'GITHUB_TOKEN', credentialId: 42, credentialName: 'Bot', agentType: null },
				];
				mockListProjectOverrides.mockResolvedValue(overrides);
				const caller = createCaller({ user: mockUser });

				const result = await caller.credentialOverrides.list({ projectId: 'p1' });

				expect(result).toEqual(overrides);
			});
		});

		describe('set', () => {
			it('sets override after verifying project and credential ownership', async () => {
				// First call: verify project, second call: verify credential
				mockDbWhere.mockResolvedValueOnce([{ orgId: 'org-1' }]);
				mockDbWhere.mockResolvedValueOnce([{ orgId: 'org-1' }]);
				mockSetProjectCredentialOverride.mockResolvedValue(undefined);
				const caller = createCaller({ user: mockUser });

				await caller.credentialOverrides.set({
					projectId: 'p1',
					envVarKey: 'GITHUB_TOKEN',
					credentialId: 42,
				});

				expect(mockSetProjectCredentialOverride).toHaveBeenCalledWith('p1', 'GITHUB_TOKEN', 42);
			});

			it('throws NOT_FOUND when credential belongs to different org', async () => {
				mockDbWhere.mockResolvedValueOnce([{ orgId: 'org-1' }]); // project OK
				mockDbWhere.mockResolvedValueOnce([{ orgId: 'different-org' }]); // credential not owned
				const caller = createCaller({ user: mockUser });

				await expect(
					caller.credentialOverrides.set({
						projectId: 'p1',
						envVarKey: 'KEY',
						credentialId: 99,
					}),
				).rejects.toMatchObject({ code: 'NOT_FOUND' });
			});
		});

		describe('remove', () => {
			it('removes override after verifying ownership', async () => {
				mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
				mockRemoveProjectCredentialOverride.mockResolvedValue(undefined);
				const caller = createCaller({ user: mockUser });

				await caller.credentialOverrides.remove({
					projectId: 'p1',
					envVarKey: 'GITHUB_TOKEN',
				});

				expect(mockRemoveProjectCredentialOverride).toHaveBeenCalledWith('p1', 'GITHUB_TOKEN');
			});
		});

		describe('setAgent', () => {
			it('sets agent-scoped override after verifying both ownerships', async () => {
				mockDbWhere.mockResolvedValueOnce([{ orgId: 'org-1' }]); // project
				mockDbWhere.mockResolvedValueOnce([{ orgId: 'org-1' }]); // credential
				mockSetAgentCredentialOverride.mockResolvedValue(undefined);
				const caller = createCaller({ user: mockUser });

				await caller.credentialOverrides.setAgent({
					projectId: 'p1',
					envVarKey: 'GITHUB_TOKEN',
					agentType: 'review',
					credentialId: 42,
				});

				expect(mockSetAgentCredentialOverride).toHaveBeenCalledWith(
					'p1',
					'GITHUB_TOKEN',
					'review',
					42,
				);
			});
		});

		describe('removeAgent', () => {
			it('removes agent-scoped override after verifying ownership', async () => {
				mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
				mockRemoveAgentCredentialOverride.mockResolvedValue(undefined);
				const caller = createCaller({ user: mockUser });

				await caller.credentialOverrides.removeAgent({
					projectId: 'p1',
					envVarKey: 'GITHUB_TOKEN',
					agentType: 'review',
				});

				expect(mockRemoveAgentCredentialOverride).toHaveBeenCalledWith(
					'p1',
					'GITHUB_TOKEN',
					'review',
				);
			});
		});
	});
});
