import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TRPCContext } from '../../../../src/api/trpc.js';
import { createMockSuperAdmin, createMockUser } from '../../../helpers/factories.js';

const {
	mockListAgentConfigs,
	mockCreateAgentConfig,
	mockUpdateAgentConfig,
	mockDeleteAgentConfig,
	mockGetEngineCatalog,
	mockRegisterBuiltInEngines,
} = vi.hoisted(() => ({
	mockListAgentConfigs: vi.fn(),
	mockCreateAgentConfig: vi.fn(),
	mockUpdateAgentConfig: vi.fn(),
	mockDeleteAgentConfig: vi.fn(),
	mockGetEngineCatalog: vi.fn(),
	mockRegisterBuiltInEngines: vi.fn(),
}));

vi.mock('../../../../src/db/repositories/settingsRepository.js', () => ({
	listAgentConfigs: (...args: unknown[]) => mockListAgentConfigs(...args),
	createAgentConfig: (...args: unknown[]) => mockCreateAgentConfig(...args),
	updateAgentConfig: (...args: unknown[]) => mockUpdateAgentConfig(...args),
	deleteAgentConfig: (...args: unknown[]) => mockDeleteAgentConfig(...args),
}));

vi.mock('../../../../src/backends/index.js', () => ({
	getEngineCatalog: (...args: unknown[]) => mockGetEngineCatalog(...args),
	registerBuiltInEngines: (...args: unknown[]) => mockRegisterBuiltInEngines(...args),
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
	agentConfigs: { id: 'id', orgId: 'org_id', projectId: 'project_id' },
	projects: { id: 'id', orgId: 'org_id' },
}));

import { agentConfigsRouter } from '../../../../src/api/routers/agentConfigs.js';

function createCaller(ctx: TRPCContext) {
	return agentConfigsRouter.createCaller(ctx);
}

const mockUser = createMockUser();

describe('agentConfigsRouter', () => {
	beforeEach(() => {
		mockDbSelect.mockReturnValue({ from: mockDbFrom });
		mockDbFrom.mockReturnValue({ where: mockDbWhere });
		mockGetEngineCatalog.mockReturnValue([
			{
				id: 'llmist',
				label: 'LLMist',
				description: 'LLMist',
				capabilities: [],
				modelSelection: { type: 'free-text' },
				logLabel: 'LLMist Log',
			},
			{
				id: 'claude-code',
				label: 'Claude Code',
				description: 'Claude Code',
				capabilities: [],
				modelSelection: {
					type: 'select',
					defaultValueLabel: 'Default',
					options: [
						{
							value: 'claude-sonnet-4-5-20250929',
							label: 'Claude Sonnet 4.5',
						},
					],
				},
				logLabel: 'Claude Code Log',
			},
		]);
	});

	describe('list', () => {
		it('lists org-scoped configs when no projectId', async () => {
			const configs = [{ id: 1, agentType: 'implementation', model: 'claude-sonnet-4-5-20250929' }];
			mockListAgentConfigs.mockResolvedValue(configs);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.list();

			expect(mockListAgentConfigs).toHaveBeenCalledWith({ orgId: 'org-1' });
			expect(result).toEqual(configs);
		});

		it('lists project-scoped configs when projectId provided', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
			const configs = [{ id: 2, agentType: 'review', projectId: 'proj-1' }];
			mockListAgentConfigs.mockResolvedValue(configs);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.list({ projectId: 'proj-1' });

			expect(mockListAgentConfigs).toHaveBeenCalledWith({ projectId: 'proj-1' });
			expect(result).toEqual(configs);
		});

		it('throws NOT_FOUND when project does not belong to org', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'different-org' }]);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await expect(caller.list({ projectId: 'proj-x' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('throws NOT_FOUND when project does not exist', async () => {
			mockDbWhere.mockResolvedValue([]);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await expect(caller.list({ projectId: 'missing' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.list()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
		});
	});

	describe('create', () => {
		it('creates org-scoped config', async () => {
			mockCreateAgentConfig.mockResolvedValue({ id: 10 });
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.create({
				agentType: 'implementation',
				model: 'claude-sonnet-4-5-20250929',
				maxIterations: 25,
			});

			expect(mockCreateAgentConfig).toHaveBeenCalledWith({
				orgId: 'org-1',
				projectId: null,
				agentType: 'implementation',
				model: 'claude-sonnet-4-5-20250929',
				maxIterations: 25,
			});
			expect(result).toEqual({ id: 10 });
		});

		it('creates project-scoped config after verifying ownership', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
			mockCreateAgentConfig.mockResolvedValue({ id: 11 });
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await caller.create({
				projectId: 'proj-1',
				agentType: 'review',
				agentEngine: 'claude-code',
			});

			expect(mockCreateAgentConfig).toHaveBeenCalledWith(
				expect.objectContaining({
					projectId: 'proj-1',
					agentType: 'review',
					agentEngine: 'claude-code',
				}),
			);
		});

		it('throws NOT_FOUND when project does not belong to org', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'different-org' }]);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await expect(
				caller.create({ projectId: 'proj-x', agentType: 'review' }),
			).rejects.toMatchObject({ code: 'NOT_FOUND' });
		});

		it('rejects empty agentType', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.create({ agentType: '' })).rejects.toThrow();
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.create({ agentType: 'test' })).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});
	});

	describe('update', () => {
		it('updates org-scoped config', async () => {
			// First call: find config
			mockDbWhere.mockResolvedValueOnce([{ orgId: 'org-1', projectId: null }]);
			mockUpdateAgentConfig.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await caller.update({ id: 10, model: 'new-model', maxIterations: 30 });

			expect(mockUpdateAgentConfig).toHaveBeenCalledWith(10, {
				model: 'new-model',
				maxIterations: 30,
			});
		});

		it('updates project-scoped config after verifying project ownership', async () => {
			// First call: find config
			mockDbWhere.mockResolvedValueOnce([{ orgId: null, projectId: 'proj-1' }]);
			// Second call: verify project
			mockDbWhere.mockResolvedValueOnce([{ orgId: 'org-1' }]);
			mockUpdateAgentConfig.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await caller.update({ id: 11, agentEngine: 'claude-code' });

			expect(mockUpdateAgentConfig).toHaveBeenCalledWith(11, {
				agentEngine: 'claude-code',
			});
		});

		it('throws NOT_FOUND when config does not exist', async () => {
			mockDbWhere.mockResolvedValue([]);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await expect(caller.update({ id: 999, model: 'x' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('throws NOT_FOUND when org-scoped config belongs to different org', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'different-org', projectId: null }]);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await expect(caller.update({ id: 10, model: 'x' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.update({ id: 10, model: 'x' })).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});

		it('throws FORBIDDEN when non-superadmin updates a global config', async () => {
			mockDbWhere.mockResolvedValueOnce([{ orgId: null, projectId: null }]);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await expect(caller.update({ id: 10, model: 'x' })).rejects.toMatchObject({
				code: 'FORBIDDEN',
				message: 'Superadmin access required',
			});
		});

		it('allows superadmin to update a global config', async () => {
			mockDbWhere.mockResolvedValueOnce([{ orgId: null, projectId: null }]);
			mockUpdateAgentConfig.mockResolvedValue(undefined);
			const superAdmin = createMockSuperAdmin();
			const caller = createCaller({ user: superAdmin, effectiveOrgId: superAdmin.orgId });

			await caller.update({ id: 10, model: 'global-model' });

			expect(mockUpdateAgentConfig).toHaveBeenCalledWith(10, { model: 'global-model' });
		});
	});

	describe('delete', () => {
		it('deletes org-scoped config', async () => {
			mockDbWhere.mockResolvedValueOnce([{ orgId: 'org-1', projectId: null }]);
			mockDeleteAgentConfig.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await caller.delete({ id: 10 });

			expect(mockDeleteAgentConfig).toHaveBeenCalledWith(10);
		});

		it('deletes project-scoped config after verifying project ownership', async () => {
			mockDbWhere.mockResolvedValueOnce([{ orgId: null, projectId: 'proj-1' }]);
			mockDbWhere.mockResolvedValueOnce([{ orgId: 'org-1' }]);
			mockDeleteAgentConfig.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await caller.delete({ id: 11 });

			expect(mockDeleteAgentConfig).toHaveBeenCalledWith(11);
		});

		it('throws NOT_FOUND when config does not exist', async () => {
			mockDbWhere.mockResolvedValue([]);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await expect(caller.delete({ id: 999 })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('throws NOT_FOUND when org-scoped config belongs to different org', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'different-org', projectId: null }]);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await expect(caller.delete({ id: 10 })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.delete({ id: 10 })).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});

		it('throws FORBIDDEN when non-superadmin deletes a global config', async () => {
			mockDbWhere.mockResolvedValueOnce([{ orgId: null, projectId: null }]);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await expect(caller.delete({ id: 10 })).rejects.toMatchObject({
				code: 'FORBIDDEN',
				message: 'Superadmin access required',
			});
		});

		it('allows superadmin to delete a global config', async () => {
			mockDbWhere.mockResolvedValueOnce([{ orgId: null, projectId: null }]);
			mockDeleteAgentConfig.mockResolvedValue(undefined);
			const superAdmin = createMockSuperAdmin();
			const caller = createCaller({ user: superAdmin, effectiveOrgId: superAdmin.orgId });

			await caller.delete({ id: 10 });

			expect(mockDeleteAgentConfig).toHaveBeenCalledWith(10);
		});
	});

	describe('create with maxConcurrency', () => {
		it('passes maxConcurrency to repository when creating org-scoped config', async () => {
			mockCreateAgentConfig.mockResolvedValue({ id: 20 });
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await caller.create({
				agentType: 'implementation',
				maxConcurrency: 3,
			});

			expect(mockCreateAgentConfig).toHaveBeenCalledWith(
				expect.objectContaining({
					agentType: 'implementation',
					maxConcurrency: 3,
				}),
			);
		});

		it('passes maxConcurrency to repository when creating project-scoped config', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
			mockCreateAgentConfig.mockResolvedValue({ id: 21 });
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await caller.create({
				projectId: 'proj-1',
				agentType: 'review',
				maxConcurrency: 2,
			});

			expect(mockCreateAgentConfig).toHaveBeenCalledWith(
				expect.objectContaining({
					projectId: 'proj-1',
					agentType: 'review',
					maxConcurrency: 2,
				}),
			);
		});
	});

	describe('update with maxConcurrency', () => {
		it('passes maxConcurrency to repository when updating org-scoped config', async () => {
			mockDbWhere.mockResolvedValueOnce([{ orgId: 'org-1', projectId: null }]);
			mockUpdateAgentConfig.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await caller.update({ id: 10, maxConcurrency: 5 });

			expect(mockUpdateAgentConfig).toHaveBeenCalledWith(
				10,
				expect.objectContaining({ maxConcurrency: 5 }),
			);
		});

		it('passes maxConcurrency to repository when updating project-scoped config', async () => {
			// First call: find config
			mockDbWhere.mockResolvedValueOnce([{ orgId: null, projectId: 'proj-1' }]);
			// Second call: verify project ownership
			mockDbWhere.mockResolvedValueOnce([{ orgId: 'org-1' }]);
			mockUpdateAgentConfig.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await caller.update({ id: 11, maxConcurrency: 4 });

			expect(mockUpdateAgentConfig).toHaveBeenCalledWith(
				11,
				expect.objectContaining({ maxConcurrency: 4 }),
			);
		});

		it('can set maxConcurrency alongside other fields', async () => {
			mockDbWhere.mockResolvedValueOnce([{ orgId: 'org-1', projectId: null }]);
			mockUpdateAgentConfig.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await caller.update({ id: 10, model: 'new-model', maxConcurrency: 2, maxIterations: 20 });

			expect(mockUpdateAgentConfig).toHaveBeenCalledWith(10, {
				agentType: undefined,
				model: 'new-model',
				maxIterations: 20,
				maxConcurrency: 2,
			});
		});
	});
});
