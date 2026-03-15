import { TRPCError } from '@trpc/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TRPCContext } from '../../../../src/api/trpc.js';
import { registerBuiltInEngines } from '../../../../src/backends/bootstrap.js';
import { createMockUser } from '../../../helpers/factories.js';

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

const mockListProjectCredentials = vi.fn();
const mockWriteProjectCredential = vi.fn();
const mockDeleteProjectCredential = vi.fn();

vi.mock('../../../../src/db/repositories/credentialsRepository.js', () => ({
	listProjectCredentials: (...args: unknown[]) => mockListProjectCredentials(...args),
	writeProjectCredential: (...args: unknown[]) => mockWriteProjectCredential(...args),
	deleteProjectCredential: (...args: unknown[]) => mockDeleteProjectCredential(...args),
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
	projects: { id: 'id', orgId: 'org_id' },
}));

import { projectsRouter } from '../../../../src/api/routers/projects.js';

function createCaller(ctx: TRPCContext) {
	return projectsRouter.createCaller(ctx);
}

const mockUser = createMockUser();

beforeAll(() => {
	registerBuiltInEngines();
});

describe('projectsRouter', () => {
	beforeEach(() => {
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
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.list();

			expect(mockListProjectsForOrg).toHaveBeenCalledWith('org-1');
			expect(result).toEqual([
				{ id: 'p1', name: 'Project 1' },
				{ id: 'p2', name: 'Project 2' },
			]);
		});

		it('returns empty array when org has no projects', async () => {
			mockListProjectsForOrg.mockResolvedValue([]);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.list();
			expect(result).toEqual([]);
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });

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
			const projects = [
				{
					id: 'p1',
					name: 'Project 1',
					repo: 'owner/repo1',
					baseBranch: 'main',
					agentEngineSettings: { codex: { approvalPolicy: 'never' } },
				},
			];
			mockListProjectsFull.mockResolvedValue(projects);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.listFull();

			expect(mockListProjectsFull).toHaveBeenCalledWith('org-1');
			expect(result).toEqual([
				{
					id: 'p1',
					name: 'Project 1',
					repo: 'owner/repo1',
					baseBranch: 'main',
					engineSettings: { codex: { approvalPolicy: 'never' } },
				},
			]);
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.listFull()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
		});
	});

	describe('getById', () => {
		it('returns project when found', async () => {
			const project = {
				id: 'p1',
				orgId: 'org-1',
				name: 'Project 1',
				agentEngineSettings: { codex: { sandboxMode: 'read-only' } },
			};
			mockGetProjectFull.mockResolvedValue(project);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.getById({ id: 'p1' });

			expect(mockGetProjectFull).toHaveBeenCalledWith('p1', 'org-1');
			expect(result).toEqual({
				id: 'p1',
				orgId: 'org-1',
				name: 'Project 1',
				engineSettings: { codex: { sandboxMode: 'read-only' } },
			});
		});

		it('throws NOT_FOUND when project does not exist', async () => {
			mockGetProjectFull.mockResolvedValue(null);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await expect(caller.getById({ id: 'missing' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});
	});

	describe('create', () => {
		it('creates project with required fields', async () => {
			const created = { id: 'my-project', orgId: 'org-1', name: 'My Project', repo: 'owner/repo' };
			mockCreateProject.mockResolvedValue(created);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.create({
				id: 'my-project',
				name: 'My Project',
				repo: 'owner/repo',
				engineSettings: { codex: { approvalPolicy: 'never' } },
			});

			expect(mockCreateProject).toHaveBeenCalledWith('org-1', {
				id: 'my-project',
				name: 'My Project',
				repo: 'owner/repo',
				engineSettings: { codex: { approvalPolicy: 'never' } },
			});
			expect(result).toEqual(created);
		});

		it('rejects invalid id format', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.create({ id: 'INVALID ID!', name: 'X', repo: 'owner/repo' }),
			).rejects.toThrow();
		});

		it('rejects empty name', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.create({ id: 'valid-id', name: '', repo: 'owner/repo' }),
			).rejects.toThrow();
		});

		it('rejects unsupported engine settings on create', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await expect(
				caller.create({
					id: 'valid-id',
					name: 'Project',
					repo: 'owner/repo',
					engineSettings: {
						unknown: { foo: 'bar' },
					},
				}),
			).rejects.toThrow('Unsupported engine settings');
		});
	});

	describe('update', () => {
		it('updates project after verifying ownership', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
			mockUpdateProject.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await caller.update({ id: 'p1', name: 'Updated Name', model: 'new-model' });

			expect(mockUpdateProject).toHaveBeenCalledWith('p1', 'org-1', {
				name: 'Updated Name',
				model: 'new-model',
			});
		});

		it('throws NOT_FOUND when project belongs to different org', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'different-org' }]);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await expect(caller.update({ id: 'p1', name: 'X' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
			expect(mockUpdateProject).not.toHaveBeenCalled();
		});

		it('passes engineSettings through on update', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
			mockUpdateProject.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await caller.update({
				id: 'p1',
				engineSettings: { codex: { approvalPolicy: 'never', webSearch: false } },
			});

			expect(mockUpdateProject).toHaveBeenCalledWith('p1', 'org-1', {
				engineSettings: { codex: { approvalPolicy: 'never', webSearch: false } },
			});
		});

		it('rejects unsupported engine settings on update', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await expect(
				caller.update({
					id: 'p1',
					engineSettings: {
						unknown: { foo: 'bar' },
					},
				}),
			).rejects.toThrow('Unsupported engine settings');
			expect(mockUpdateProject).not.toHaveBeenCalled();
		});
	});

	describe('delete', () => {
		it('deletes project after verifying ownership', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
			mockDeleteProject.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await caller.delete({ id: 'p1' });

			expect(mockDeleteProject).toHaveBeenCalledWith('p1', 'org-1');
		});

		it('throws NOT_FOUND when project belongs to different org', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'different-org' }]);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

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
				const integrations = [
					{
						id: 1,
						category: 'pm',
						provider: 'trello',
						config: { boardId: 'abc' },
						triggers: {},
					},
				];
				mockListProjectIntegrations.mockResolvedValue(integrations);
				const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

				const result = await caller.integrations.list({ projectId: 'p1' });

				expect(result).toEqual(integrations);
			});

			it('throws NOT_FOUND when project not owned', async () => {
				mockDbWhere.mockResolvedValue([{ orgId: 'other-org' }]);
				const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

				await expect(caller.integrations.list({ projectId: 'p1' })).rejects.toMatchObject({
					code: 'NOT_FOUND',
				});
			});
		});

		describe('upsert', () => {
			it('upserts integration after verifying ownership', async () => {
				mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
				mockUpsertProjectIntegration.mockResolvedValue(undefined);
				const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

				await caller.integrations.upsert({
					projectId: 'p1',
					category: 'pm',
					provider: 'trello',
					config: { boardId: 'abc123' },
				});

				expect(mockUpsertProjectIntegration).toHaveBeenCalledWith(
					'p1',
					'pm',
					'trello',
					{ boardId: 'abc123' },
					undefined,
				);
			});
		});

		describe('delete', () => {
			it('deletes integration after verifying ownership', async () => {
				mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
				mockDeleteProjectIntegration.mockResolvedValue(undefined);
				const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

				await caller.integrations.delete({ projectId: 'p1', category: 'pm' });

				expect(mockDeleteProjectIntegration).toHaveBeenCalledWith('p1', 'pm');
			});
		});
	});

	// ============================================================================
	// projects.credentials.* sub-router
	// ============================================================================

	describe('credentials', () => {
		describe('list', () => {
			it('throws UNAUTHORIZED when not authenticated', async () => {
				const caller = createCaller({ user: null, effectiveOrgId: null });
				await expect(caller.credentials.list({ projectId: 'p1' })).rejects.toMatchObject({
					code: 'UNAUTHORIZED',
				});
			});

			it('returns masked metadata — never plaintext', async () => {
				mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
				mockListProjectCredentials.mockResolvedValue([
					{ envVarKey: 'OPENROUTER_API_KEY', name: 'OpenRouter Key', value: 'sk-or-12345678' },
					{ envVarKey: 'SHORT', name: null, value: '123' },
				]);
				const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

				const result = await caller.credentials.list({ projectId: 'p1' });

				expect(result).toEqual([
					{
						envVarKey: 'OPENROUTER_API_KEY',
						name: 'OpenRouter Key',
						isConfigured: true,
						maskedValue: '****5678',
					},
					{
						envVarKey: 'SHORT',
						name: null,
						isConfigured: true,
						maskedValue: '****',
					},
				]);
			});

			it('calls listProjectCredentials with projectId', async () => {
				mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
				mockListProjectCredentials.mockResolvedValue([]);
				const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

				await caller.credentials.list({ projectId: 'p1' });

				expect(mockListProjectCredentials).toHaveBeenCalledWith('p1');
			});

			it('returns project NOT_FOUND when project does not belong to org', async () => {
				mockDbWhere.mockResolvedValue([{ orgId: 'different-org' }]);
				const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

				await expect(caller.credentials.list({ projectId: 'p1' })).rejects.toMatchObject({
					code: 'NOT_FOUND',
				});
			});
		});

		describe('set', () => {
			it('throws UNAUTHORIZED when not authenticated', async () => {
				const caller = createCaller({ user: null, effectiveOrgId: null });
				await expect(
					caller.credentials.set({
						projectId: 'p1',
						envVarKey: 'OPENROUTER_API_KEY',
						value: 'sk-or-abc',
					}),
				).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
			});

			it('calls writeProjectCredential with correct args', async () => {
				mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
				mockWriteProjectCredential.mockResolvedValue(undefined);
				const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

				await caller.credentials.set({
					projectId: 'p1',
					envVarKey: 'OPENROUTER_API_KEY',
					value: 'sk-or-abc123',
					name: 'OpenRouter',
				});

				expect(mockWriteProjectCredential).toHaveBeenCalledWith(
					'p1',
					'OPENROUTER_API_KEY',
					'sk-or-abc123',
					'OpenRouter',
				);
			});

			it('rejects envVarKey with invalid format', async () => {
				const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
				await expect(
					caller.credentials.set({
						projectId: 'p1',
						envVarKey: 'lower-case-key',
						value: 'value',
					}),
				).rejects.toThrow();
			});

			it('rejects empty value', async () => {
				const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
				await expect(
					caller.credentials.set({
						projectId: 'p1',
						envVarKey: 'OPENROUTER_API_KEY',
						value: '',
					}),
				).rejects.toThrow();
			});
		});

		describe('delete', () => {
			it('throws UNAUTHORIZED when not authenticated', async () => {
				const caller = createCaller({ user: null, effectiveOrgId: null });
				await expect(
					caller.credentials.delete({ projectId: 'p1', envVarKey: 'OPENROUTER_API_KEY' }),
				).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
			});

			it('calls deleteProjectCredential with correct args', async () => {
				mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
				mockDeleteProjectCredential.mockResolvedValue(undefined);
				const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

				await caller.credentials.delete({ projectId: 'p1', envVarKey: 'OPENROUTER_API_KEY' });

				expect(mockDeleteProjectCredential).toHaveBeenCalledWith('p1', 'OPENROUTER_API_KEY');
			});
		});
	});
});
