---
id: 021
slug: multi-org-membership
plan: 2
plan_slug: access
level: plan
parent_spec: docs/specs/021-multi-org-membership.md
depends_on: [1-schema.md]
status: pending
---

# 021/2: Membership-based org resolution, active-org switching, per-org roles

> Part 2 of 4 in the 021-multi-org-membership plan. See [parent spec](../../specs/021-multi-org-membership.md).

## Summary

The high-risk core: change how a request's **effective org** is resolved and how a user's **role** is evaluated, moving both from the single `users.org_id` / global `users.role` to the membership model + the session's active org — **without changing superadmin behavior and without logging anyone out**. After this plan, a multi-org user's requests are scoped to their *active* org (defaulting to their home org), and permission checks use their role *in that org*.

This plan adds: membership-aware effective-org resolution, an active-org switch endpoint (validated against membership), a "list my orgs" read for the switcher, and a per-org role helper that the existing user-management permission checks consume. It deliberately does NOT add the grant/create/list admin mutations (plan 3) or any UI (plan 4) — those build on the resolution + role primitives introduced here.

**Components delivered:**
- `src/api/context.ts` — `resolveEffectiveOrgId` reads `session.active_org_id` (membership-validated) → else home org; superadmin override preserved.
- `src/api/` (session/auth router) — `setActiveOrg` mutation + `listMyOrgs` query.
- A per-org actor-role helper (membership role in the effective org; `superadmin` stays global) consumed by `src/api/routers/users.ts` permission rules.

**Deferred to later plans in this spec:**
- Grant-membership / graceful-create / member-list mutations + CLI (plan 3).
- Org switcher + member-management UI (plan 4).

---

## Spec ACs satisfied by this plan

- Spec AC #3 (multi-org user can enumerate their orgs + select an active one; data scoped to it) — **partial** (this plan provides `listMyOrgs` + `setActiveOrg` + the scoping; plan 4 provides the switcher UI).
- Spec AC #4 (effective permissions in the active org governed by the per-org role; admin in one org, member in another) — **full**.
- Spec AC #7 (superadmins retain cross-org access, unchanged) — **full**.
- Spec AC #8 (an org admin cannot view/grant another org's data; only superadmin acts cross-org) — **full** (the resolution + per-org role enforce this; plan 3 reuses it for grant).

---

## Depends On

- Plan 1 (schema) — provides `org_memberships`, `sessions.active_org_id`, and `membershipsRepository`.

---

## Detailed Task List (TDD)

### 1. Effective-org resolution from membership + active org

**Tests first** (`tests/unit/api/context.test.ts`):
- `defaults to home org when no active_org_id` — unit — user with `org_id=A`, session `active_org_id=null` → effectiveOrgId `A`. Expected red: passes today (regression guard) — assert it still equals home; this test must continue green and is the no-logout guard.
- `honors active_org_id when the user is a member of that org` — unit — user home=A, member of A+B, session `active_org_id=B` → `B`. Expected red: `expected 'B', got 'A'` (resolution ignores active org today).
- `ignores active_org_id when the user is NOT a member of that org` — unit — session `active_org_id=C`, no membership in C → falls back to home `A`. Expected red: `expected 'A', got 'C'`.
- `superadmin requestedOrgId override is unchanged` — unit — superadmin, `requestedOrgId=Z` (exists) → `Z`; non-existent → home. Expected red: passes today (regression guard for AC #7).

**Implementation** (`src/api/context.ts`):
- `resolveEffectiveOrgId(user, { requestedOrgId, activeOrgId }): Promise<string>`:
  1. superadmin + valid `requestedOrgId` → that org (existing behavior, preserved).
  2. else `activeOrgId` set AND `getMembershipRole(user.id, activeOrgId) != null` → `activeOrgId`.
  3. else `user.orgId` (home).
- Thread `session.active_org_id` into the context where the session is loaded (the place that builds `effectiveOrgId`).

### 2. Per-org actor role

**Tests first** (`tests/unit/api/actor-role.test.ts`):
- `actor role in the active org = membership role` — unit — user member-in-A, admin-in-B; effective B → `'admin'`; effective A → `'member'`. Expected red: function-not-exported / returns global role.
- `superadmin is global regardless of membership` — unit — `users.role='superadmin'` → actor role `'superadmin'` for any effective org. Expected red: returns membership role.

**Implementation** (helper in `src/api/context.ts` or a small `src/api/auth/`):
- `resolveActorRole(user, effectiveOrgId): Promise<'member'|'admin'|'superadmin'>` = `user.role === 'superadmin' ? 'superadmin' : (await getMembershipRole(user.id, effectiveOrgId)) ?? 'member'`.
- Wire `ctx` so org-scoped procedures see this per-org role (replace the single `user.role` used for org-scoped authorization in `src/api/routers/users.ts`; keep `user.role` for the global superadmin gate).

### 3. `setActiveOrg` + `listMyOrgs`

**Tests first** (`tests/unit/api/routers/session-orgs.test.ts`):
- `listMyOrgs returns the caller's memberships with org name + role` — unit — Expected red: procedure-not-found.
- `setActiveOrg succeeds when the caller is a member of the target org` — unit — sets `session.active_org_id`. Expected red: procedure-not-found.
- `setActiveOrg rejects an org the caller is not a member of (FORBIDDEN)` — unit — non-member target → `TRPCError FORBIDDEN`. Expected red: procedure-not-found.
- `superadmin may setActiveOrg to any existing org` — unit — Expected red: procedure-not-found.

**Implementation** (`src/api/routers/` — extend the session/auth router):
- `listMyOrgs: protectedProcedure.query` → `listMembershipsForUser(ctx.user.id)` joined to org names (+ superadmins may also enumerate all orgs — match existing superadmin listing behavior).
- `setActiveOrg: protectedProcedure.input({ orgId }).mutation` → validate membership (or superadmin), then persist `sessions.active_org_id` for the caller's session; return the new effective org.

### 4. users-router permission uses per-org role (AC #8)

**Tests first** (extend `tests/unit/api/routers/users.test.ts`):
- `an admin (per-org) can manage users in their active org` — unit — Expected red: still keyed off global `users.role` (passes/fails depending — assert it uses the per-org role).
- `an admin of org A cannot manage a user in org B` — integration/unit — actor admin-in-A, effective A; target in B → `NOT_FOUND` (unchanged guard, now membership-aware). Expected red: `expected NOT_FOUND` if the check regressed.
- `superadmin still manages cross-org + the superadmin role` — unit — Expected red: regression guard for AC #7.

**Implementation** (`src/api/routers/users.ts`):
- Replace the org-scoped role checks to use `resolveActorRole` (per-org) for admin gating; keep `user.role === 'superadmin'` for the global superadmin-only rules. The `target.orgId !== actor.effectiveOrgId && actor.role !== 'superadmin'` guard stays but `actor.role` is now the per-org role.

---

## Test Plan

### Unit tests
- [ ] `context.test.ts`: ~4 — resolution (home default, active honored/ignored, superadmin override).
- [ ] `actor-role.test.ts`: ~2 — per-org role + superadmin global.
- [ ] `session-orgs.test.ts`: ~4 — list/set active org + validation.
- [ ] `users.test.ts` (extended): ~3 — per-org admin gating + superadmin unchanged.

### Integration tests
- [ ] active-org round-trip: set active org → a subsequent org-scoped query returns the new org's data (requires test DB + a seeded multi-org user).

### Acceptance tests
- [ ] Per-plan ACs below (resolution, switching API, per-org role, superadmin unchanged, cross-org denial).

---

## Manual Verification

*n/a — all ACs auto-tested.*

---

## Acceptance Criteria (per-plan, testable)

1. `resolveEffectiveOrgId` returns home org by default, the active org when the caller is a member, ignores a non-member active org, and preserves the superadmin `requestedOrgId` override.
2. `listMyOrgs` returns the caller's orgs (+ role); `setActiveOrg` sets the session's active org only when the caller is a member (or superadmin), else FORBIDDEN.
3. Org-scoped permission checks use the caller's **per-org** role; a user can be admin in one org and member in another with checks reflecting the active org.
4. An admin of one org cannot manage another org's users; superadmin cross-org behavior is byte-for-byte unchanged.
5. No existing session is invalidated by the resolution change (the home-org default test is green).
6. All new/modified code has tests; `npm run build`, `npm test`, `npm run test:integration`, `npm run lint`, `npm run typecheck` pass.
7. Documentation listed below is updated.

---

## Documentation Impact (this plan only)

| File | Change |
|---|---|
| `docs/getting-started.md` | Note that a user's effective org = their active org (default home), and roles are per-org. |
| `CHANGELOG.md` | Entry: "Resolve effective org from membership + active-org selection; per-org roles; superadmin unchanged." |

---

## Out of Scope (this plan)

- Granting membership / graceful duplicate-email create / member listing / CLI (plan 3).
- Org switcher + admin UI (plan 4).
- Removing `users.org_id` (kept as home org).
- Email invitations (spec out of scope).

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
