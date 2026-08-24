---
id: 021
slug: multi-org-membership
plan: 1
plan_slug: schema
level: plan
parent_spec: docs/specs/021-multi-org-membership.md
depends_on: []
status: pending
---

# 021/1: Membership schema + active-org column + backfill

> Part 1 of 4 in the 021-multi-org-membership plan. See [parent spec](../../specs/021-multi-org-membership.md).

## Summary

Introduces the data model for multi-org membership: a new `org_memberships` table linking a user to an organization with a per-org role, and an `active_org_id` column on `sessions` so a session can remember which org the user is acting in. A forward-only migration backfills exactly one membership per existing user (their current `users.org_id` + role), so the model is populated and consistent the moment it lands.

This plan ships **dormant**: nothing reads the new table or column yet (plan 2 wires resolution). It is reviewable in isolation — a schema diff + a deterministic backfill. The global `users.org_id` and `users.role` columns are **kept** (home/primary org + global role incl. `superadmin`); the membership `role` is the per-org role (`member`/`admin`), and a `superadmin` global role backfills to an `admin` home-org membership.

**Components delivered:**
- `src/db/schema/memberships.ts` — `orgMemberships` Drizzle table.
- `src/db/schema/users.ts` — add `activeOrgId` to the `sessions` table.
- `src/db/migrations/{NN}_org_memberships.sql` + `src/db/migrations/meta/_journal.json` entry.
- `src/db/repositories/membershipsRepository.ts` — minimal read/write helpers (insert membership, list memberships for user, get membership role).

**Deferred to later plans in this spec:**
- Resolving the effective org from membership / active-org (plan 2).
- Grant/create/list mutations + CLI (plan 3).
- Org switcher + member-management UI (plan 4).

---

## Spec ACs satisfied by this plan

- Spec AC #6 (after migration every pre-existing user has exactly one membership = prior org + role; stays logged in; same default org) — **full**.

---

## Depends On

- None (Layer 0).

---

## Detailed Task List (TDD)

### 1. `orgMemberships` table + `sessions.activeOrgId`

**Tests first** (`tests/unit/db/schema/memberships.test.ts`):
- `orgMemberships has user_id, org_id, role columns + unique(user_id, org_id)` — unit — import the table, assert column set + the unique index name is present in the table config. Expected red: `Cannot find module '.../schema/memberships.js'` (table not created yet).
- `membership role defaults to 'member'` — unit — inspect the `role` column default. Expected red: module-not-found (same).
- `sessions has activeOrgId column (nullable, FK to organizations, onDelete set null)` — unit — inspect `sessions` config. Expected red: `expected sessions to have column 'active_org_id'` (column absent).

**Implementation** (`src/db/schema/memberships.ts`, edit `src/db/schema/users.ts`):
- `orgMemberships = pgTable('org_memberships', { id: uuid pk default random, userId: uuid notNull → users.id onDelete cascade, orgId: text notNull → organizations.id onDelete cascade, role: text notNull default 'member', createdAt, updatedAt }, (t) => [ uniqueIndex('uq_org_memberships_user_org').on(t.userId, t.orgId), index('idx_org_memberships_user').on(t.userId), index('idx_org_memberships_org').on(t.orgId) ])`.
- In `users.ts` `sessions`: add `activeOrgId: text('active_org_id').references(() => organizations.id, { onDelete: 'set null' })` (nullable). Avoid a top-level import cycle (organizations already imported by users.ts).

### 2. Migration + backfill

**Tests first** (`tests/integration/db/migrations-membership.test.ts`):
- `backfill creates exactly one membership per pre-existing user, role copied (superadmin→admin)` — integration — seed users {member, admin, superadmin} across two orgs, run the migration SQL, assert one `org_memberships` row per user with org=users.org_id and role = (superadmin→'admin', else users.role). Expected red: `relation "org_memberships" does not exist` (or 0 rows).
- `backfill is idempotent under the journal (re-running migrate does not duplicate)` — integration — run migrate twice, assert membership count unchanged. Expected red: duplicate rows / unique-violation.
- `migration preserves users.org_id and users.role` — integration — assert the columns + values unchanged post-migration. Expected red: column dropped / changed.

**Implementation** (`src/db/migrations/{NN}_org_memberships.sql`, `meta/_journal.json`):
- Create `org_memberships` (columns + unique + indexes as above) and add `active_org_id` to `sessions` (nullable FK, `ON DELETE SET NULL`).
- Backfill: `INSERT INTO org_memberships (user_id, org_id, role) SELECT id, org_id, CASE WHEN role='superadmin' THEN 'admin' ELSE role END FROM users ON CONFLICT (user_id, org_id) DO NOTHING;`
- `NN` = current highest migration number + 1; add the matching `_journal.json` entry (unique `when`, `tag` = filename without `.sql`).

### 3. `membershipsRepository` (minimal)

**Tests first** (`tests/unit/db/repositories/membershipsRepository.test.ts`):
- `listMembershipsForUser returns the user's {orgId, role} rows` — unit (mock db) — Expected red: function-not-exported.
- `getMembershipRole(userId, orgId) returns the role or null` — unit — Expected red: function-not-exported.
- `createMembership inserts (userId, orgId, role) and is a no-op on conflict` — unit — assert insert called with onConflictDoNothing. Expected red: function-not-exported.

**Implementation** (`src/db/repositories/membershipsRepository.ts`):
- `listMembershipsForUser(userId: string): Promise<Array<{ orgId: string; role: string }>>`
- `getMembershipRole(userId: string, orgId: string): Promise<string | null>`
- `createMembership(userId: string, orgId: string, role: string): Promise<void>` (insert … onConflictDoNothing)

---

## Test Plan

### Unit tests
- [ ] `memberships.test.ts`: ~3 — table/column/index shape.
- [ ] `membershipsRepository.test.ts`: ~3 — read/write helpers.

### Integration tests
- [ ] `migrations-membership.test.ts`: ~3 — backfill correctness, idempotency, column preservation (requires Postgres test DB).

### Acceptance tests
- [ ] Maps to per-plan AC #1 (backfill) below.

---

## Manual Verification

*n/a — all ACs auto-tested.*

---

## Acceptance Criteria (per-plan, testable)

1. `org_memberships` exists with `(user_id, org_id, role)` and a unique `(user_id, org_id)`; `sessions.active_org_id` exists (nullable FK).
2. Running the migration on a DB with pre-existing users in ≥2 orgs backfills exactly one membership per user (org = their `org_id`; role copied, `superadmin`→`admin`), is idempotent, and leaves `users.org_id`/`users.role` intact. (Dormant: no app code reads the new table/column yet.)
3. `membershipsRepository` read/write helpers are covered by unit tests.
4. All new/modified code has corresponding tests.
5. `npm run build` passes.
6. `npm test` and `npm run test:integration` pass.
7. `npm run lint` and `npm run typecheck` pass.
8. Documentation listed below is updated.

**Partial-state criterion:** the `org_memberships` table + `sessions.active_org_id` exist and are backfilled, but no resolution/auth code consumes them yet — reviewable in isolation.

---

## Documentation Impact (this plan only)

| File | Change |
|---|---|
| `CHANGELOG.md` | Entry: "Add `org_memberships` table + `sessions.active_org_id` (dormant) with backfill — groundwork for multi-org membership." |
| `CLAUDE.md` (Database section) | One line only IF needed: the migration is hand-written SQL + journal entry per the existing convention — likely no edit (convention already documented). Re-validate against the CLAUDE.md rubric; default skip. |

---

## Out of Scope (this plan)

- Reading membership/active-org for org resolution (plan 2).
- Grant/create/list mutations + CLI (plan 3).
- UI (plan 4).
- Removing `users.org_id` (spec: kept as home/primary org).
- Email invitation flow (spec out of scope).

---

## Progress

<!-- /implement updates these as it works. Do not edit manually. -->
- [ ] AC #1
- [ ] AC #2
- [ ] AC #3
- [ ] AC #4
- [ ] AC #5
- [ ] AC #6
- [ ] AC #7
- [ ] AC #8
