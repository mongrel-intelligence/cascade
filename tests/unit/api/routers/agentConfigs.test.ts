import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TRPCContext } from '../../../../src/api/trpc.js';
import { createMockUser } from '../../../helpers/factories.js';

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
	agentConfigs: { id: 'id', projectId: 'project_id' },
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
		it('lists project-scoped configs when projectId provided', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
			const configs = [{ id: 2, agentType: 'review', projectId: 'proj-1' }];
			mockListAgentConfigs.mockResolvedValue(configs);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.list({ projectId: 'proj-1' });

			expect(mockListAgentConfigs).toHaveBeenCalledWith({ projectId: 'proj-1' });
			expect(result).toEqual(configs);
		});

		it('requires projectId', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			// @ts-expect-error: testing missing required param
			await expect(caller.list()).rejects.toThrow();
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
			await expect(caller.list({ projectId: 'proj-1' })).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});
	});

	describe('create', () => {
		it('creates project-scoped config after verifying ownership', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
			mockCreateAgentConfig.mockResolvedValue({ id: 11 });
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.create({
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
			expect(result).toEqual({ id: 11 });
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
			await expect(caller.create({ projectId: 'proj-1', agentType: '' })).rejects.toThrow();
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.create({ projectId: 'proj-1', agentType: 'test' })).rejects.toMatchObject(
				{
					code: 'UNAUTHORIZED',
				},
			);
		});
	});

	describe('update', () => {
		it('updates project-scoped config after verifying project ownership', async () => {
			// First call: find config
			mockDbWhere.mockResolvedValueOnce([{ projectId: 'proj-1' }]);
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

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.update({ id: 10, model: 'x' })).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});
	});

	describe('delete', () => {
		it('deletes project-scoped config after verifying project ownership', async () => {
			mockDbWhere.mockResolvedValueOnce([{ projectId: 'proj-1' }]);
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

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.delete({ id: 10 })).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});
	});

	describe('create with maxConcurrency', () => {
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
		it('passes maxConcurrency to repository when updating project-scoped config', async () => {
			// First call: find config
			mockDbWhere.mockResolvedValueOnce([{ projectId: 'proj-1' }]);
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
			mockDbWhere.mockResolvedValueOnce([{ projectId: 'proj-1' }]);
			mockDbWhere.mockResolvedValueOnce([{ orgId: 'org-1' }]);
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
