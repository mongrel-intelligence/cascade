import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDbWithGetDb } from '../../../helpers/mockDb.js';
import { mockDbClientModule } from '../../../helpers/sharedMocks.js';

vi.mock('../../../../src/db/client.js', () => mockDbClientModule);

vi.mock('../../../../src/db/schema/index.js', () => ({
	orgMemberships: {
		id: 'id',
		userId: 'user_id',
		orgId: 'org_id',
		role: 'role',
	},
	organizations: {
		id: 'id',
		name: 'name',
	},
	users: {
		id: 'id',
		orgId: 'org_id',
		email: 'email',
		name: 'name',
		role: 'role',
		createdAt: 'created_at',
		updatedAt: 'updated_at',
	},
}));

import {
	addOrgMembership,
	getOrgMembership,
	listOrgMembers,
	listOrgMembershipsForUser,
} from '../../../../src/db/repositories/orgMembershipsRepository.js';

describe('orgMembershipsRepository', () => {
	let mockDb: ReturnType<typeof createMockDbWithGetDb>;

	beforeEach(() => {
		mockDb = createMockDbWithGetDb({ withUpsert: true });
	});

	describe('getOrgMembership', () => {
		it('returns the membership row when the user belongs to the org', async () => {
			mockDb.chain.where.mockResolvedValueOnce([{ orgId: 'org-2', role: 'admin' }]);

			const result = await getOrgMembership('user-1', 'org-2');
			expect(result).toEqual({ orgId: 'org-2', role: 'admin' });
		});

		it('returns null when there is no membership', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await getOrgMembership('user-1', 'org-2');
			expect(result).toBeNull();
		});
	});

	describe('listOrgMembershipsForUser', () => {
		it('returns every org the user belongs to joined with the org name', async () => {
			const rows = [
				{ id: 'org-1', name: 'Org One', role: 'admin' },
				{ id: 'org-2', name: 'Org Two', role: 'member' },
			];
			mockDb.chain.where.mockResolvedValueOnce(rows);

			const result = await listOrgMembershipsForUser('user-1');
			expect(result).toEqual(rows);
			expect(mockDb.chain.innerJoin).toHaveBeenCalled();
		});

		it('returns an empty array when the user has no memberships', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await listOrgMembershipsForUser('user-1');
			expect(result).toEqual([]);
		});
	});

	describe('listOrgMembers', () => {
		it('returns the org membership with per-org role + isGuest (home org != listed org)', async () => {
			const rows = [
				{
					id: 'user-1',
					orgId: 'org-2',
					email: 'alice@example.com',
					name: 'Alice',
					role: 'admin',
					globalRole: 'admin',
					homeOrgId: 'org-2', // home org == listed org
					createdAt: null,
					updatedAt: null,
				},
				{
					id: 'user-2',
					orgId: 'org-2',
					email: 'bob@example.com',
					name: 'Bob',
					role: 'member',
					globalRole: 'member',
					homeOrgId: 'org-9', // home org elsewhere → guest
					createdAt: null,
					updatedAt: null,
				},
			];
			mockDb.chain.where.mockResolvedValueOnce(rows);

			const result = await listOrgMembers('org-2');
			expect(result).toEqual([
				{ ...rows[0], isGuest: false },
				{ ...rows[1], isGuest: true },
			]);
			expect(mockDb.chain.innerJoin).toHaveBeenCalled();
		});

		it('applies the excludeGlobalRole filter when provided', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			await listOrgMembers('org-2', { excludeGlobalRole: 'superadmin' });
			// The join + filtered where is the terminal; both conditions land there.
			expect(mockDb.chain.innerJoin).toHaveBeenCalled();
			expect(mockDb.chain.where).toHaveBeenCalledTimes(1);
		});

		it('returns an empty array when the org has no members', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await listOrgMembers('empty-org');
			expect(result).toEqual([]);
		});
	});

	describe('addOrgMembership', () => {
		it('upserts the membership with the given role (idempotent re-grant)', async () => {
			await addOrgMembership({ userId: 'user-1', orgId: 'org-2', role: 'admin' });

			expect(mockDb.db.insert).toHaveBeenCalledTimes(1);
			expect(mockDb.chain.values).toHaveBeenCalledWith({
				userId: 'user-1',
				orgId: 'org-2',
				role: 'admin',
			});
			expect(mockDb.chain.onConflictDoUpdate).toHaveBeenCalledTimes(1);
			const setArg = mockDb.chain.onConflictDoUpdate.mock.calls[0][0].set;
			expect(setArg.role).toBe('admin');
			expect(setArg.updatedAt).toBeInstanceOf(Date);
		});

		it('defaults the role to member when omitted', async () => {
			await addOrgMembership({ userId: 'user-1', orgId: 'org-2' });

			expect(mockDb.chain.values).toHaveBeenCalledWith({
				userId: 'user-1',
				orgId: 'org-2',
				role: 'member',
			});
		});
	});
});
