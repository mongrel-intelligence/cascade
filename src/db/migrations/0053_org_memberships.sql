-- 0053_org_memberships.sql
-- Multi-org membership (spec 021, plan 1 of 4): introduce the data model so one
-- account can belong to many orgs.
--
-- Adds:
--   * org_memberships         — user <-> org link with a per-org role.
--   * sessions.active_org_id  — the org a session is currently acting in.
--
-- Backfills exactly one membership per existing user from their home org
-- (users.org_id) and role, mapping the global 'superadmin' role to an 'admin'
-- membership (membership roles are per-org; 'superadmin' is a global role).
--
-- Ships DORMANT: nothing reads the new table/column yet (plan 2 wires
-- resolution). users.org_id / users.role are retained as the home/primary org
-- and global role. Forward-only — no down migration.

BEGIN;

-- 1. org_memberships: a user's membership in an org, with a per-org role.
CREATE TABLE IF NOT EXISTS org_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- At most one membership per (user, org).
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_memberships_user_org
  ON org_memberships(user_id, org_id);

-- Resolution lookups (plan 2) and per-org member listing.
CREATE INDEX IF NOT EXISTS idx_org_memberships_user_id ON org_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_org_memberships_org_id ON org_memberships(org_id);

-- 2. sessions.active_org_id: which org this session is currently acting in.
--    Nullable; ON DELETE SET NULL so deleting an org never logs a user out —
--    plan 2's resolver falls back to the user's home org when this is NULL.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS active_org_id TEXT
  REFERENCES organizations(id) ON DELETE SET NULL;

-- 3. Backfill exactly one membership per existing user from their home org +
--    role. Map the global 'superadmin' role to an 'admin' membership.
--    Idempotent via ON CONFLICT on the (user_id, org_id) unique index.
INSERT INTO org_memberships (user_id, org_id, role)
SELECT
  u.id,
  u.org_id,
  CASE WHEN u.role = 'superadmin' THEN 'admin' ELSE u.role END
FROM users u
ON CONFLICT (user_id, org_id) DO NOTHING;

COMMIT;
