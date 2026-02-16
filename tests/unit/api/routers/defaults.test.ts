import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TRPCContext } from '../../../../src/api/trpc.js';

const mockGetCascadeDefaults = vi.fn();
const mockUpsertCascadeDefaults = vi.fn();

vi.mock('../../../../src/db/repositories/settingsRepository.js', () => ({
	getCascadeDefaults: (...args: unknown[]) => mockGetCascadeDefaults(...args),
	upsertCascadeDefaults: (...args: unknown[]) => mockUpsertCascadeDefaults(...args),
}));

import { defaultsRouter } from '../../../../src/api/routers/defaults.js';

function createCaller(ctx: TRPCContext) {
	return defaultsRouter.createCaller(ctx);
}

const mockUser = {
	id: 'user-1',
	orgId: 'org-1',
	email: 'test@example.com',
	name: 'Test',
	role: 'admin',
};

describe('defaultsRouter', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('get', () => {
		it('returns cascade defaults for user orgId', async () => {
			const mockDefaults = {
				orgId: 'org-1',
				model: 'claude-sonnet-4-5-20250929',
				maxIterations: 20,
			};
			mockGetCascadeDefaults.mockResolvedValue(mockDefaults);
			const caller = createCaller({ user: mockUser });

			const result = await caller.get();

			expect(mockGetCascadeDefaults).toHaveBeenCalledWith('org-1');
			expect(result).toEqual(mockDefaults);
		});

		it('returns null when no defaults configured', async () => {
			mockGetCascadeDefaults.mockResolvedValue(null);
			const caller = createCaller({ user: mockUser });

			const result = await caller.get();
			expect(result).toBeNull();
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null });
			await expect(caller.get()).rejects.toThrow(TRPCError);
			await expect(caller.get()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
		});
	});

	describe('upsert', () => {
		it('upserts all fields', async () => {
			mockUpsertCascadeDefaults.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockUser });

			await caller.upsert({
				model: 'claude-sonnet-4-5-20250929',
				maxIterations: 30,
				watchdogTimeoutMs: 300000,
				cardBudgetUsd: '5.00',
				agentBackend: 'claude-code',
				progressModel: 'claude-haiku-3-20240307',
				progressIntervalMinutes: '10',
			});

			expect(mockUpsertCascadeDefaults).toHaveBeenCalledWith('org-1', {
				model: 'claude-sonnet-4-5-20250929',
				maxIterations: 30,
				watchdogTimeoutMs: 300000,
				cardBudgetUsd: '5.00',
				agentBackend: 'claude-code',
				progressModel: 'claude-haiku-3-20240307',
				progressIntervalMinutes: '10',
			});
		});

		it('accepts partial updates with null values', async () => {
			mockUpsertCascadeDefaults.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockUser });

			await caller.upsert({ model: null, maxIterations: 15 });

			expect(mockUpsertCascadeDefaults).toHaveBeenCalledWith(
				'org-1',
				expect.objectContaining({ model: null, maxIterations: 15 }),
			);
		});

		it('accepts empty input', async () => {
			mockUpsertCascadeDefaults.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockUser });

			await caller.upsert({});

			expect(mockUpsertCascadeDefaults).toHaveBeenCalledWith('org-1', {});
		});

		it('rejects negative maxIterations', async () => {
			const caller = createCaller({ user: mockUser });
			await expect(caller.upsert({ maxIterations: -1 })).rejects.toThrow();
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null });
			await expect(caller.upsert({ model: 'test' })).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});
	});
});
