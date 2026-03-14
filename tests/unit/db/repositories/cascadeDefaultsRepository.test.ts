import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDb } from '../../../helpers/mockDb.js';

vi.mock('../../../../src/db/client.js', () => ({
	getDb: vi.fn(),
}));

import { getDb } from '../../../../src/db/client.js';
import {
	getCascadeDefaults,
	upsertCascadeDefaults,
} from '../../../../src/db/repositories/cascadeDefaultsRepository.js';

describe('cascadeDefaultsRepository', () => {
	let mockDb: ReturnType<typeof createMockDb>;

	beforeEach(() => {
		mockDb = createMockDb({ withUpsert: true, withThenable: true });
		vi.mocked(getDb).mockReturnValue(mockDb.db as never);
	});

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
});
