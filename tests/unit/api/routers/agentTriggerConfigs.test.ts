import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TRPCContext } from '../../../../src/api/trpc.js';
import { createMockUser } from '../../../helpers/factories.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetTriggerConfigById = vi.fn();
const mockGetTriggerConfig = vi.fn();
const mockGetTriggerConfigsByProject = vi.fn();
const mockGetTriggerConfigsByProjectAndAgent = vi.fn();
const mockUpsertTriggerConfig = vi.fn();
const mockUpdateTriggerConfig = vi.fn();
const mockDeleteTriggerConfig = vi.fn();

vi.mock('../../../../src/db/repositories/agentTriggerConfigsRepository.js', () => ({
	getTriggerConfigById: (...args: unknown[]) => mockGetTriggerConfigById(...args),
	getTriggerConfig: (...args: unknown[]) => mockGetTriggerConfig(...args),
	getTriggerConfigsByProject: (...args: unknown[]) => mockGetTriggerConfigsByProject(...args),
	getTriggerConfigsByProjectAndAgent: (...args: unknown[]) =>
		mockGetTriggerConfigsByProjectAndAgent(...args),
	upsertTriggerConfig: (...args: unknown[]) => mockUpsertTriggerConfig(...args),
	updateTriggerConfig: (...args: unknown[]) => mockUpdateTriggerConfig(...args),
	deleteTriggerConfig: (...args: unknown[]) => mockDeleteTriggerConfig(...args),
}));

const mockVerifyProjectOrgAccess = vi.fn();

vi.mock('../../../../src/api/routers/_shared/projectAccess.js', () => ({
	verifyProjectOrgAccess: (...args: unknown[]) => mockVerifyProjectOrgAccess(...args),
}));

import { agentTriggerConfigsRouter } from '../../../../src/api/routers/agentTriggerConfigs.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createCaller(ctx: TRPCContext) {
	return agentTriggerConfigsRouter.createCaller(ctx);
}

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
		vi.clearAllMocks();
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
			await expect(caller.listByProject({ projectId: 'test-project' })).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
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
			await expect(
				caller.listByProjectAndAgent({ projectId: 'test-project', agentType: 'implementation' }),
			).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
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
			await expect(
				caller.upsert({
					projectId: 'test-project',
					agentType: 'implementation',
					triggerEvent: 'pm:status-changed',
				}),
			).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
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
			await expect(caller.update({ id: 1, enabled: false })).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
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
			await expect(caller.delete({ id: 1 })).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});
	});

	// =====================================================================
	// bulkUpsert
	// =====================================================================
	describe('bulkUpsert', () => {
		it('bulk upserts multiple trigger configs', async () => {
			const configs = [
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
			await expect(
				caller.bulkUpsert({
					projectId: 'test-project',
					configs: [],
				}),
			).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});
	});
});
