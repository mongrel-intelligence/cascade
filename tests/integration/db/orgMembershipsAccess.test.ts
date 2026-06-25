/**
 * Integration tests for multi-org membership access resolution
 * (spec 021, plan 2 of 4).
 *
 * Exercises the plan-2 primitives against a real database:
 *   - orgMembershipsRepository reads (getOrgMembership, listOrgMembershipsForUser)
 *   - session active-org round-trip (setSessionActiveOrg → getSessionByToken)
 *   - membership-aware effective-org resolution (computeEffectiveOrgId)
 *   - per-org actor-role evaluation (resolveActorRoleInOrg)
 *
 * The no-logout guarantee is asserted directly: a session with a NULL or
 * stale active org resolves to the user's home org instead of failing.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { computeEffectiveOrgId, resolveActorRoleInOrg } from '../../../src/api/context.js';
import {
	getOrgMembership,
	listOrgMembershipsForUser,
} from '../../../src/db/repositories/orgMembershipsRepository.js';
import {
	getSessionByToken,
	setSessionActiveOrg,
} from '../../../src/db/repositories/usersRepository.js';
import { truncateAll } from '../helpers/db.js';
import { seedMembership, seedOrg, seedSession, seedUser } from '../helpers/seed.js';

type TestUser = {
	id: string;
	orgId: string;
	email: string;
	name: string;
	role: 'member' | 'admin' | 'superadmin';
};

function asTRPCUser(row: { id: string; orgId: string; role: string }): TestUser {
	return {
		id: row.id,
		orgId: row.orgId,
		email: 'user@example.com',
		name: 'User',
		role: row.role as TestUser['role'],
	};
}

describe('multi-org membership access (integration)', () => {
	beforeEach(async () => {
		await truncateAll();
		await seedOrg('home-org', 'Home Org');
		await seedOrg('other-org', 'Other Org');
	});

	describe('orgMembershipsRepository', () => {
		it('getOrgMembership returns the per-org role when a membership exists', async () => {
			const user = await seedUser({ orgId: 'home-org', email: 'm@example.com', role: 'member' });
			await seedMembership({ userId: user.id, orgId: 'other-org', role: 'admin' });

			const membership = await getOrgMembership(user.id, 'other-org');
			expect(membership).toEqual({ orgId: 'other-org', role: 'admin' });
		});

		it('getOrgMembership returns null when there is no membership', async () => {
			const user = await seedUser({ orgId: 'home-org', email: 'n@example.com' });
			expect(await getOrgMembership(user.id, 'other-org')).toBeNull();
		});

		it('listOrgMembershipsForUser returns each org with its name and per-org role', async () => {
			const user = await seedUser({ orgId: 'home-org', email: 'l@example.com', role: 'admin' });
			await seedMembership({ userId: user.id, orgId: 'home-org', role: 'admin' });
			await seedMembership({ userId: user.id, orgId: 'other-org', role: 'member' });

			const orgs = await listOrgMembershipsForUser(user.id);
			expect(orgs).toEqual(
				expect.arrayContaining([
					{ id: 'home-org', name: 'Home Org', role: 'admin' },
					{ id: 'other-org', name: 'Other Org', role: 'member' },
				]),
			);
			expect(orgs).toHaveLength(2);
		});
	});

	describe('session active-org round-trip', () => {
		it('setSessionActiveOrg persists and getSessionByToken reads it back', async () => {
			const user = await seedUser({ orgId: 'home-org', email: 's@example.com' });
			await seedSession({ userId: user.id, token: 'tok-active' });

			await setSessionActiveOrg('tok-active', 'other-org');

			const session = await getSessionByToken('tok-active');
			expect(session?.activeOrgId).toBe('other-org');
		});

		it('a fresh session reports a NULL active org (no-logout default)', async () => {
			const user = await seedUser({ orgId: 'home-org', email: 'f@example.com' });
			await seedSession({ userId: user.id, token: 'tok-null' });

			const session = await getSessionByToken('tok-null');
			expect(session?.activeOrgId).toBeNull();
		});
	});

	describe('computeEffectiveOrgId', () => {
		it('returns the active org when the member has a membership there', async () => {
			const row = await seedUser({ orgId: 'home-org', email: 'a@example.com', role: 'member' });
			await seedMembership({ userId: row.id, orgId: 'other-org', role: 'member' });

			const eff = await computeEffectiveOrgId(asTRPCUser(row), undefined, 'other-org');
			expect(eff).toBe('other-org');
		});

		it('falls back to the home org when the active-org membership is gone (no-logout)', async () => {
			const row = await seedUser({ orgId: 'home-org', email: 'b@example.com', role: 'member' });
			// No membership seeded in other-org.
			const eff = await computeEffectiveOrgId(asTRPCUser(row), undefined, 'other-org');
			expect(eff).toBe('home-org');
		});

		it('falls back to the home org when the session has no active org (no-logout)', async () => {
			const row = await seedUser({ orgId: 'home-org', email: 'c@example.com', role: 'member' });
			const eff = await computeEffectiveOrgId(asTRPCUser(row), undefined, null);
			expect(eff).toBe('home-org');
		});
	});

	describe('resolveActorRoleInOrg', () => {
		it('uses the per-org membership role for a switched org', async () => {
			const row = await seedUser({ orgId: 'home-org', email: 'd@example.com', role: 'admin' });
			await seedMembership({ userId: row.id, orgId: 'other-org', role: 'member' });

			// Admin at home, but only a member in other-org (spec AC #8).
			const role = await resolveActorRoleInOrg({
				userId: row.id,
				globalRole: 'admin',
				homeOrgId: 'home-org',
				orgId: 'other-org',
			});
			expect(role).toBe('member');
		});

		it('superadmin stays superadmin in any org without a membership (AC #7)', async () => {
			const row = await seedUser({ orgId: 'home-org', email: 'e@example.com', role: 'admin' });
			const role = await resolveActorRoleInOrg({
				userId: row.id,
				globalRole: 'superadmin',
				homeOrgId: 'home-org',
				orgId: 'other-org',
			});
			expect(role).toBe('superadmin');
		});
	});
});
