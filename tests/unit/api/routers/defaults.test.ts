import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';
import type { TRPCContext } from '../../../../src/api/trpc.js';
import { createMockUser } from '../../../helpers/factories.js';

import { defaultsRouter } from '../../../../src/api/routers/defaults.js';

function createCaller(ctx: TRPCContext) {
	return defaultsRouter.createCaller(ctx);
}

const mockUser = createMockUser();

describe('defaultsRouter', () => {
	describe('get', () => {
		it('returns null since cascade_defaults table has been removed', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.get();
			expect(result).toBeNull();
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.get()).rejects.toThrow(TRPCError);
			await expect(caller.get()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
		});
	});

	describe('upsert', () => {
		it('returns a deprecation notice since cascade_defaults table has been removed', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.upsert({
				model: 'claude-sonnet-4-5-20250929',
				maxIterations: 30,
			});
			expect(result).toMatchObject({ ok: true, deprecated: true });
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.upsert({ model: 'test' })).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});
	});
});
