---
id: 021
slug: multi-org-membership
plan: 3
plan_slug: management
level: plan
parent_spec: docs/specs/021-multi-org-membership.md
depends_on: [2-access.md]
status: pending
---

# 021/3: Grant membership, graceful create, membership-based member list + CLI

> Part 3 of 4 in the 021-multi-org-membership plan. See [parent spec](../../specs/021-multi-org-membership.md).

## Summary

The additive admin side: the actual "add an existing account to an org" capability (the operation the bug report needed), graceful handling of the duplicate-email create (no more 500), a member listing that reads membership (so an org shows all its members, including people whose home org is elsewhere), and CLI parity for all of it. Built on plan 2's per-org role + resolution primitives.

After this plan, an admin of an org (or a superadmin) can grant an existing email a membership in *their* org with a role, via API and CLI; creating a user with an existing email returns a clear, actionable result instead of an Internal Server Error; and listing an org's users returns its true membership.

**Components delivered:**
- `src/api/routers/users.ts` — `addExistingUserToOrg` (grant membership) mutation; `createUser` graceful duplicate-email handling; org-members list reads membership.
- `src/db/repositories/usersRepository.ts` / `membershipsRepository.ts` — `findUserByEmail`, membership-join member listing.
- `src/cli/dashboard/users/` — `add-to-org` command; `list` reads membership; create/update messaging for the duplicate case.

**Deferred to later plans in this spec:**
- Org switcher + add-to-org form + member-list UI (plan 4).

---

## Spec ACs satisfied by this plan

- Spec AC #1 (an admin can add an existing account to their org with a role; it then has access) — **full** (API + CLI; plan 4 adds the dashboard form as a UX affordance).
- Spec AC #2 (creating a user with an already-registered email never 500s; distinguishes "already a member here" vs "exists elsewhere — add to this org") — **full**.
- Spec AC #5 (an org's member list shows everyone with membership, regardless of home org) — **partial** (this plan provides the membership-based listing API/CLI; plan 4 renders it).

---

## Depends On

- Plan 2 (access) — provides `resolveActorRole` (per-org admin gate) and the membership primitives the grant + listing reuse.
- Plan 1 (schema) — `org_memberships`, `membershipsRepository`.

---

## Detailed Task List (TDD)

### 1. `addExistingUserToOrg` (grant membership)

**Tests first** (`tests/unit/api/routers/users-grant.test.ts`):
- `target-org admin can add an existing email to their org with a role` — unit — actor admin-in-B, input {email of existing user, orgId B, role member} → membership created. Expected red: procedure-not-found.
- `superadmin can add to any org` — unit — Expected red: procedure-not-found.
- `a non-admin / admin-of-another-org cannot grant (FORBIDDEN)` — unit — actor admin-in-A, target org B → FORBIDDEN. Expected red: procedure-not-found.
- `granting an email with no account returns a typed NOT_FOUND (not a silent create)` — unit — Expected red: procedure-not-found.
- `granting a user already a member of the org is idempotent (no error, no duplicate)` — unit — Expected red: procedure-not-found / unique-violation.

**Implementation** (`src/api/routers/users.ts`, `membershipsRepository`):
- `addExistingUserToOrg: adminProcedure.input({ email, orgId, role }).mutation`:
  - authorize: `resolveActorRole(ctx.user, input.orgId)` is `admin`, OR `ctx.user.role === 'superadmin'`; else FORBIDDEN.
  - `findUserByEmail(input.email)`; if none → `TRPCError NOT_FOUND` ("no account for that email").
  - `createMembership(user.id, input.orgId, input.role)` (idempotent onConflict).
- `findUserByEmail(email): Promise<{id,...}|null>` in `usersRepository`.

### 2. Graceful duplicate-email create (AC #2)

**Tests first** (`tests/unit/api/routers/users-create.test.ts`):
- `creating a brand-new email in the caller's org succeeds` — unit — Expected red: passes today (regression guard).
- `creating with an email that already exists returns a typed CONFLICT, never an unhandled 500` — unit — assert `TRPCError code 'CONFLICT'` with a message distinguishing "already a member of this org" vs "account exists — add it to this org". Expected red: `expected TRPCError CONFLICT, got <unhandled unique-violation / 500>`.
- `the conflict message names the add-to-org path` — unit — Expected red: message mismatch.

**Implementation** (`src/api/routers/users.ts` / `usersRepository.createUser`):
- Pre-check (or catch Postgres `23505`): if the email exists, throw `TRPCError({ code: 'CONFLICT', message })` — message branches on whether the existing account already has a membership in the caller's org ("already a member here") vs not ("account exists; use add-to-org"). Never let the raw unique violation become a 500.

### 3. Membership-based member listing (AC #5)

**Tests first** (`tests/unit/api/routers/users-list.test.ts`):
- `listing an org's users returns every account with a membership in that org` — unit/integration — seed a user whose home org is A but who has a membership in B; list org B → includes that user with role from the B membership. Expected red: `expected user X in org B's list` (current query filters `users.org_id = B` only).
- `a member's role shown is their per-org role` — unit — Expected red: shows global role.

**Implementation** (`src/api/routers/users.ts`, `membershipsRepository`):
- Member list query joins `org_memberships` (filtered by org) → `users`, returning `{user, role: membershipRole}`. Replace the `users.org_id = ?` listing for the org-members view; keep superadmin's all-orgs listing.

### 4. CLI parity

**Tests first** (`tests/unit/cli/users-add-to-org.test.ts`):
- `users add-to-org --email --org --role calls the grant mutation` — unit — Expected red: command-not-registered.
- `users list --org reads membership (shows cross-home members)` — unit — Expected red: still home-org filtered.
- `users create surfaces the CONFLICT message (not a stack trace)` — unit — Expected red: prints raw error.

**Implementation** (`src/cli/dashboard/users/`):
- New `add-to-org.ts` command (`--email`, `--org`, `--role`) → `addExistingUserToOrg`.
- `list.ts` → membership-based listing.
- `create.ts` → render the CONFLICT envelope cleanly.

---

## Test Plan

### Unit tests
- [ ] `users-grant.test.ts`: ~5 — grant authz + existence + idempotency.
- [ ] `users-create.test.ts`: ~3 — graceful conflict.
- [ ] `users-list.test.ts`: ~2 — membership-based listing.
- [ ] `users-add-to-org.test.ts` (CLI): ~3 — command wiring + messaging.

### Integration tests
- [ ] grant → the granted user can resolve/switch to the new org (round-trip with plan 2's `setActiveOrg`).

### Acceptance tests
- [ ] Per-plan ACs below.

---

## Manual Verification

*n/a — all ACs auto-tested.*

---

## Acceptance Criteria (per-plan, testable)

1. A target-org admin (or superadmin) can add an existing email to that org with a role via API and CLI; a non-admin or cross-org admin gets FORBIDDEN; granting a non-existent email returns NOT_FOUND; re-granting is idempotent.
2. Creating a user with an already-registered email returns a typed CONFLICT (never an unhandled 500), with a message distinguishing "already a member of this org" from "account exists — add it to this org".
3. Listing an org's users returns every account with a membership in that org (including cross-home members), each with its per-org role.
4. All new/modified code has tests; `npm run build`, `npm test`, `npm run test:integration`, `npm run lint`, `npm run typecheck` pass.
5. Documentation listed below is updated.

---

## Documentation Impact (this plan only)

| File | Change |
|---|---|
| `docs/getting-started.md` | Document adding an existing account to an org (API + `cascade users add-to-org`), and the membership-based member list. |
| `CHANGELOG.md` | Entry: "Add existing accounts to additional orgs (grant membership); graceful duplicate-email create; membership-based member listing + CLI." |

---

## Out of Scope (this plan)

- Org switcher + admin UI rendering (plan 4).
- Email invitation flow (spec out of scope).
- Removing `users.org_id`.

---

## Progress

<!-- /implement updates these as it works. Do not edit manually. -->
- [ ] AC #1
- [ ] AC #2
- [ ] AC #3
- [ ] AC #4
- [ ] AC #5
