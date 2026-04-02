import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockUser } from '../../../helpers/factories.js';
import { createCallerFor, expectTRPCError } from '../../../helpers/trpcTestHarness.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
	mockGetTriggerConfigById,
	mockGetTriggerConfig,
	mockGetTriggerConfigsByProject,
	mockGetTriggerConfigsByProjectAndAgent,
	mockUpsertTriggerConfig,
	mockUpdateTriggerConfig,
	mockDeleteTriggerConfig,
	mockVerifyProjectOrgAccess,
} = vi.hoisted(() => ({
	mockGetTriggerConfigById: vi.fn(),
	mockGetTriggerConfig: vi.fn(),
	mockGetTriggerConfigsByProject: vi.fn(),
	mockGetTriggerConfigsByProjectAndAgent: vi.fn(),
	mockUpsertTriggerConfig: vi.fn(),
	mockUpdateTriggerConfig: vi.fn(),
	mockDeleteTriggerConfig: vi.fn(),
	mockVerifyProjectOrgAccess: vi.fn(),
}));

vi.mock('../../../../src/db/repositories/agentTriggerConfigsRepository.js', () => ({
	getTriggerConfigById: mockGetTriggerConfigById,
	getTriggerConfig: mockGetTriggerConfig,
	getTriggerConfigsByProject: mockGetTriggerConfigsByProject,
	getTriggerConfigsByProjectAndAgent: mockGetTriggerConfigsByProjectAndAgent,
	upsertTriggerConfig: mockUpsertTriggerConfig,
	updateTriggerConfig: mockUpdateTriggerConfig,
	deleteTriggerConfig: mockDeleteTriggerConfig,
}));

vi.mock('../../../../src/api/routers/_shared/projectAccess.js', () => ({
	verifyProjectOrgAccess: mockVerifyProjectOrgAccess,
}));

import { agentTriggerConfigsRouter } from '../../../../src/api/routers/agentTriggerConfigs.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createCaller = createCallerFor(agentTriggerConfigsRouter);

const mockUser = createMockUser();

function createMockConfig(overrides?: Record<string, unknown>) {
	return {
		id: 1,
		projectId: 'test-project',
		agentType: 'implementation',
		triggerEvent: 'pm:status-changed',
		enabled: true,
		parameters: {},
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('agentTriggerConfigsRouter', () => {
	beforeEach(() => {
		mockVerifyProjectOrgAccess.mockResolvedValue(undefined);
	});

	// =====================================================================
	// listByProject
	// =====================================================================
	describe('listByProject', () => {
		it('returns all trigger configs for a project', async () => {
			const configs = [
				createMockConfig(),
				createMockConfig({ id: 2, triggerEvent: 'pm:label-added' }),
			];
			mockGetTriggerConfigsByProject.mockResolvedValue(configs);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.listByProject({ projectId: 'test-project' });

			expect(result).toEqual(configs);
			expect(mockVerifyProjectOrgAccess).toHaveBeenCalledWith('test-project', mockUser.orgId);
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expectTRPCError(caller.listByProject({ projectId: 'test-project' }), 'UNAUTHORIZED');
		});
	});

	// =====================================================================
	// listByProjectAndAgent
	// =====================================================================
	describe('listByProjectAndAgent', () => {
		it('returns trigger configs for a specific agent', async () => {
			const configs = [createMockConfig()];
			mockGetTriggerConfigsByProjectAndAgent.mockResolvedValue(configs);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.listByProjectAndAgent({
				projectId: 'test-project',
				agentType: 'implementation',
			});

			expect(result).toEqual(configs);
			expect(mockGetTriggerConfigsByProjectAndAgent).toHaveBeenCalledWith(
				'test-project',
				'implementation',
			);
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expectTRPCError(
				caller.listByProjectAndAgent({ projectId: 'test-project', agentType: 'implementation' }),
				'UNAUTHORIZED',
			);
		});
	});

	// =====================================================================
	// get
	// =====================================================================
	describe('get', () => {
		it('returns a specific trigger config', async () => {
			const config = createMockConfig();
			mockGetTriggerConfig.mockResolvedValue(config);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.get({
				projectId: 'test-project',
				agentType: 'implementation',
				triggerEvent: 'pm:status-changed',
			});

			expect(result).toEqual(config);
		});

		it('returns null when config not found', async () => {
			mockGetTriggerConfig.mockResolvedValue(null);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.get({
				projectId: 'test-project',
				agentType: 'implementation',
				triggerEvent: 'pm:status-changed',
			});

			expect(result).toBeNull();
		});
	});

	// =====================================================================
	// upsert
	// =====================================================================
	describe('upsert', () => {
		it('creates or updates a trigger config', async () => {
			const config = createMockConfig();
			mockUpsertTriggerConfig.mockResolvedValue(config);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.upsert({
				projectId: 'test-project',
				agentType: 'implementation',
				triggerEvent: 'pm:status-changed',
				enabled: true,
				parameters: { targetList: 'todo' },
			});

			expect(result).toEqual(config);
			expect(mockUpsertTriggerConfig).toHaveBeenCalledWith({
				projectId: 'test-project',
				agentType: 'implementation',
				triggerEvent: 'pm:status-changed',
				enabled: true,
				parameters: { targetList: 'todo' },
			});
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expectTRPCError(
				caller.upsert({
					projectId: 'test-project',
					agentType: 'implementation',
					triggerEvent: 'pm:status-changed',
				}),
				'UNAUTHORIZED',
			);
		});
	});

	// =====================================================================
	// update
	// =====================================================================
	describe('update', () => {
		it('updates an existing trigger config by ID', async () => {
			const existing = createMockConfig();
			const updated = { ...existing, enabled: false };
			mockGetTriggerConfigById.mockResolvedValue(existing);
			mockUpdateTriggerConfig.mockResolvedValue(updated);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.update({ id: 1, enabled: false });

			expect(result).toEqual(updated);
			expect(mockUpdateTriggerConfig).toHaveBeenCalledWith(1, {
				enabled: false,
				parameters: undefined,
			});
		});

		it('throws NOT_FOUND when config does not exist', async () => {
			mockGetTriggerConfigById.mockResolvedValue(null);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.update({ id: 999, enabled: false })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('throws NOT_FOUND when update returns null', async () => {
			mockGetTriggerConfigById.mockResolvedValue(createMockConfig());
			mockUpdateTriggerConfig.mockResolvedValue(null);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.update({ id: 1, enabled: false })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expectTRPCError(caller.update({ id: 1, enabled: false }), 'UNAUTHORIZED');
		});
	});

	// =====================================================================
	// delete
	// =====================================================================
	describe('delete', () => {
		it('deletes a trigger config by ID', async () => {
			mockGetTriggerConfigById.mockResolvedValue(createMockConfig());
			mockDeleteTriggerConfig.mockResolvedValue(true);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await caller.delete({ id: 1 });

			expect(mockDeleteTriggerConfig).toHaveBeenCalledWith(1);
		});

		it('throws NOT_FOUND when config does not exist', async () => {
			mockGetTriggerConfigById.mockResolvedValue(null);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.delete({ id: 999 })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expectTRPCError(caller.delete({ id: 1 }), 'UNAUTHORIZED');
		});
	});

	// =====================================================================
	// bulkUpsert
	// =====================================================================
	describe('bulkUpsert', () => {
		it('bulk upserts multiple trigger configs', async () => {
			const _configs = [
				createMockConfig(),
				createMockConfig({ id: 2, triggerEvent: 'pm:label-added' }),
			];
			mockUpsertTriggerConfig.mockImplementation((input) =>
				Promise.resolve(createMockConfig({ triggerEvent: input.triggerEvent })),
			);

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.bulkUpsert({
				projectId: 'test-project',
				configs: [
					{ agentType: 'implementation', triggerEvent: 'pm:status-changed', enabled: true },
					{ agentType: 'implementation', triggerEvent: 'pm:label-added', enabled: false },
				],
			});

			expect(result).toHaveLength(2);
			expect(mockUpsertTriggerConfig).toHaveBeenCalledTimes(2);
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expectTRPCError(
				caller.bulkUpsert({
					projectId: 'test-project',
					configs: [],
				}),
				'UNAUTHORIZED',
			);
		});
	});
});
