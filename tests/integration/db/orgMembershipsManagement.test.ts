/**
 * Integration tests for the multi-org membership MANAGEMENT surface
 * (spec 021, plan 3 of 4).
 *
 * Exercises the plan-3 mutations + listing against a real database:
 *   - addOrgMembership grant (idempotent re-grant updates the per-org role)
 *   - listOrgMembers membership-based listing (true membership across home orgs,
 *     per-org role, excludeGlobalRole filter)
 *   - createUserWithMembership atomic create (user + mirrored membership; a
 *     duplicate-email unique violation rolls back, leaving no orphan rows)
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
	addOrgMembership,
	getOrgMembership,
	listOrgMembers,
	removeOrgMembership,
} from '../../../src/db/repositories/orgMembershipsRepository.js';
import {
	createUserWithMembership,
	getUserByEmail,
	updateUser,
} from '../../../src/db/repositories/usersRepository.js';
import { truncateAll } from '../helpers/db.js';
import { seedMembership, seedOrg, seedUser } from '../helpers/seed.js';

describe('multi-org membership management (integration)', () => {
	beforeEach(async () => {
		await truncateAll();
		await seedOrg('home-org', 'Home Org');
		await seedOrg('other-org', 'Other Org');
	});

	describe('addOrgMembership', () => {
		it('grants a new membership with the requested role', async () => {
			const user = await seedUser({ orgId: 'home-org', email: 'g@example.com', role: 'member' });

			await addOrgMembership({ userId: user.id, orgId: 'other-org', role: 'admin' });

			expect(await getOrgMembership(user.id, 'other-org')).toEqual({
				orgId: 'other-org',
				role: 'admin',
			});
		});

		it('is idempotent: re-granting updates the per-org role without error', async () => {
			const user = await seedUser({ orgId: 'home-org', email: 'h@example.com', role: 'member' });
			await seedMembership({ userId: user.id, orgId: 'other-org', role: 'member' });

			// Re-grant with a different role — must not throw on the unique index.
			await addOrgMembership({ userId: user.id, orgId: 'other-org', role: 'admin' });

			expect(await getOrgMembership(user.id, 'other-org')).toEqual({
				orgId: 'other-org',
				role: 'admin',
			});
			// Still exactly one membership row for this (user, org).
			const members = await listOrgMembers('other-org');
			expect(members.filter((m) => m.id === user.id)).toHaveLength(1);
		});
	});

	describe('listOrgMembers', () => {
		it('returns the org true membership including accounts whose home org is elsewhere', async () => {
			const local = await seedUser({
				orgId: 'other-org',
				email: 'local@example.com',
				role: 'member',
			});
			await seedMembership({ userId: local.id, orgId: 'other-org', role: 'member' });

			// A user whose HOME org is home-org but who is a member of other-org.
			const guest = await seedUser({
				orgId: 'home-org',
				email: 'guest@example.com',
				role: 'member',
			});
			await seedMembership({ userId: guest.id, orgId: 'other-org', role: 'admin' });

			const members = await listOrgMembers('other-org');

			expect(members).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						id: local.id,
						email: 'local@example.com',
						role: 'member',
						globalRole: 'member',
						// Home org == listed org → not a guest.
						homeOrgId: 'other-org',
						isGuest: false,
					}),
					// Per-org role (admin) wins over the guest's global role (member),
					// but the GLOBAL role is also surfaced so the editor keeps targeting
					// users.role (PR #1441 review).
					expect.objectContaining({
						id: guest.id,
						email: 'guest@example.com',
						role: 'admin',
						globalRole: 'member',
						// Home org elsewhere → guest; drives "remove from this org" UX.
						homeOrgId: 'home-org',
						isGuest: true,
					}),
				]),
			);
			expect(members).toHaveLength(2);
			// orgId reflects the listed org, not the account's home org.
			for (const m of members) {
				expect(m.orgId).toBe('other-org');
			}
		});

		it('excludeGlobalRole hides accounts whose GLOBAL role matches', async () => {
			const admin = await seedUser({ orgId: 'other-org', email: 'a@example.com', role: 'admin' });
			await seedMembership({ userId: admin.id, orgId: 'other-org', role: 'admin' });
			const sa = await seedUser({
				orgId: 'other-org',
				email: 'sa@example.com',
				role: 'superadmin',
			});
			await seedMembership({ userId: sa.id, orgId: 'other-org', role: 'admin' });

			const visible = await listOrgMembers('other-org', { excludeGlobalRole: 'superadmin' });
			expect(visible.map((m) => m.id)).toEqual([admin.id]);

			const all = await listOrgMembers('other-org');
			expect(all.map((m) => m.id).sort()).toEqual([admin.id, sa.id].sort());
		});

		it('returns an empty array for an org with no members', async () => {
			expect(await listOrgMembers('other-org')).toEqual([]);
		});
	});

	describe('createUserWithMembership', () => {
		it('creates the account and a mirrored membership atomically', async () => {
			const { id } = await createUserWithMembership({
				orgId: 'home-org',
				email: 'new@example.com',
				passwordHash: '$2b$10$hash',
				name: 'New User',
				role: 'admin',
				membershipRole: 'admin',
			});

			// The account exists with its home org + global role…
			const account = await getUserByEmail('new@example.com');
			expect(account?.id).toBe(id);
			expect(account?.orgId).toBe('home-org');
			expect(account?.role).toBe('admin');

			// …and immediately appears in the membership-based listing with the
			// per-org role.
			const members = await listOrgMembers('home-org');
			expect(members).toEqual([
				expect.objectContaining({ id, email: 'new@example.com', role: 'admin' }),
			]);
		});

		it('rolls back on a duplicate-email unique violation, leaving no orphan membership', async () => {
			// Seed an account that owns the email in a DIFFERENT org.
			await seedUser({ orgId: 'home-org', email: 'dupe@example.com', role: 'member' });

			// drizzle wraps the pg DatabaseError in a DrizzleQueryError; the
			// '23505' code lives on `.cause`.
			await expect(
				createUserWithMembership({
					orgId: 'other-org',
					email: 'dupe@example.com',
					passwordHash: '$2b$10$hash',
					name: 'Dupe',
					role: 'member',
					membershipRole: 'member',
				}),
			).rejects.toMatchObject({ cause: { code: '23505' } });

			// The transaction rolled back: other-org gained no member.
			expect(await listOrgMembers('other-org')).toEqual([]);
		});
	});

	describe('removeOrgMembership', () => {
		it('removes only the membership in the given org, leaving the account and other memberships', async () => {
			// A guest whose home org is home-org, also a member of other-org.
			const guest = await seedUser({
				orgId: 'home-org',
				email: 'guest@example.com',
				role: 'member',
			});
			await seedMembership({ userId: guest.id, orgId: 'home-org', role: 'member' });
			await seedMembership({ userId: guest.id, orgId: 'other-org', role: 'admin' });

			const result = await removeOrgMembership(guest.id, 'other-org');

			expect(result).toEqual({ removed: true });
			// Gone from other-org…
			expect(await getOrgMembership(guest.id, 'other-org')).toBeNull();
			// …but the account and its home-org membership survive.
			expect((await getUserByEmail('guest@example.com'))?.id).toBe(guest.id);
			expect(await getOrgMembership(guest.id, 'home-org')).toEqual({
				orgId: 'home-org',
				role: 'member',
			});
		});

		it('reports removed:false when there was no membership to remove', async () => {
			const user = await seedUser({
				orgId: 'home-org',
				email: 'nomember@example.com',
				role: 'member',
			});

			expect(await removeOrgMembership(user.id, 'other-org')).toEqual({ removed: false });
		});
	});

	// PR #1441 review (SHOULD_FIX): home-org permissions are read from
	// org_memberships.role (resolveActorRoleInOrg), so a global-role change must
	// also sync the home-org membership or member↔admin edits are silent no-ops.
	describe('updateUser home-org membership sync', () => {
		it('syncs the home-org membership role when the global role changes', async () => {
			const user = await seedUser({
				orgId: 'home-org',
				email: 'promote@example.com',
				role: 'member',
			});
			await seedMembership({ userId: user.id, orgId: 'home-org', role: 'member' });

			await updateUser(
				user.id,
				{ role: 'admin' },
				{ syncHomeOrgMembership: { orgId: 'home-org' } },
			);

			// Global role updated AND the membership role tracked it.
			expect((await getUserByEmail('promote@example.com'))?.role).toBe('admin');
			expect(await getOrgMembership(user.id, 'home-org')).toEqual({
				orgId: 'home-org',
				role: 'admin',
			});
		});

		it('maps a superadmin role change to an admin home-org membership', async () => {
			const user = await seedUser({
				orgId: 'home-org',
				email: 'super@example.com',
				role: 'member',
			});
			await seedMembership({ userId: user.id, orgId: 'home-org', role: 'member' });

			await updateUser(
				user.id,
				{ role: 'superadmin' },
				{ syncHomeOrgMembership: { orgId: 'home-org' } },
			);

			// Membership roles are per-org ('member' | 'admin'); superadmin → admin.
			expect(await getOrgMembership(user.id, 'home-org')).toEqual({
				orgId: 'home-org',
				role: 'admin',
			});
		});

		it('upserts the home-org membership when the legacy account has none', async () => {
			const user = await seedUser({
				orgId: 'home-org',
				email: 'legacy@example.com',
				role: 'member',
			});
			// No membership row seeded (pre-backfill account).

			await updateUser(
				user.id,
				{ role: 'admin' },
				{ syncHomeOrgMembership: { orgId: 'home-org' } },
			);

			expect(await getOrgMembership(user.id, 'home-org')).toEqual({
				orgId: 'home-org',
				role: 'admin',
			});
		});

		it('leaves membership untouched when the update does not change the role', async () => {
			const user = await seedUser({
				orgId: 'home-org',
				email: 'rename@example.com',
				role: 'admin',
			});
			await seedMembership({ userId: user.id, orgId: 'home-org', role: 'admin' });

			await updateUser(
				user.id,
				{ name: 'Renamed' },
				{ syncHomeOrgMembership: { orgId: 'home-org' } },
			);

			expect(await getOrgMembership(user.id, 'home-org')).toEqual({
				orgId: 'home-org',
				role: 'admin',
			});
		});
	});
});
