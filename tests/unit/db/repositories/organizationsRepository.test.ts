import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDb } from '../../../helpers/mockDb.js';

vi.mock('../../../../src/db/client.js', () => ({
	getDb: vi.fn(),
}));

import { getDb } from '../../../../src/db/client.js';
import {
	getOrganization,
	listAllOrganizations,
	updateOrganization,
} from '../../../../src/db/repositories/organizationsRepository.js';

describe('organizationsRepository', () => {
	let mockDb: ReturnType<typeof createMockDb>;

	beforeEach(() => {
		mockDb = createMockDb({ withUpsert: true, withThenable: true });
		vi.mocked(getDb).mockReturnValue(mockDb.db as never);
	});

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

	describe('listAllOrganizations', () => {
		it('returns all organizations', async () => {
			const orgs = [
				{ id: 'org-1', name: 'Org One' },
				{ id: 'org-2', name: 'Org Two' },
			];
			const fromMock = vi.fn().mockResolvedValue(orgs);
			mockDb.db.select.mockReturnValue({ from: fromMock });

			const result = await listAllOrganizations();
			expect(result).toEqual(orgs);
		});
	});
});
