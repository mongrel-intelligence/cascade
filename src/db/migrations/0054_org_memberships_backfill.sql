-- 0054_org_memberships_backfill.sql
-- Multi-org membership (spec 021, plan 3 of 4): re-run the idempotent
-- one-membership-per-user backfill from migration 0053.
--
-- Why a second backfill? The org member listing (`users.list` →
-- `listOrgMembers`) inner-joins `org_memberships`, so only accounts with a
-- membership row appear. Membership rows are guaranteed from the plan-1 0053
-- backfill snapshot and the new `createUserWithMembership`, but NOT for:
--   * accounts created via the old `createUser` between the 0053 backfill and
--     this deploy, and
--   * bootstrap superadmins inserted directly by `tools/create-admin-user.ts`.
-- Those accounts would silently vanish from their own org's listing (PR #1441
-- review). Re-running the backfill mirrors a home-org membership for every such
-- account, closing the window cheaply.
--
-- Idempotent via ON CONFLICT on the (user_id, org_id) unique index — accounts
-- that already have a membership are untouched, including any whose per-org role
-- diverged from the global role (the grant mutation owns those). Maps the global
-- 'superadmin' role to an 'admin' membership, mirroring 0053. Forward-only.

BEGIN;

INSERT INTO org_memberships (user_id, org_id, role)
SELECT
  u.id,
  u.org_id,
  CASE WHEN u.role = 'superadmin' THEN 'admin' ELSE u.role END
FROM users u
ON CONFLICT (user_id, org_id) DO NOTHING;

COMMIT;
