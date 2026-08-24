---
id: 021
slug: multi-org-membership
plan: 4
plan_slug: ui
level: plan
parent_spec: docs/specs/021-multi-org-membership.md
depends_on: [3-management.md]
status: pending
---

# 021/4: Org switcher, add-to-org form, membership member list (dashboard)

> Part 4 of 4 in the 021-multi-org-membership plan. See [parent spec](../../specs/021-multi-org-membership.md).

> ⚠️ Pushing files under `web/` (or any path touched here that lands in `.github/workflows`) follows the repo's normal push rules; this plan touches `web/` only.

## Summary

The user-facing layer, landing last on top of a curl-testable backend: an **org switcher** so a multi-org user can change their active org (re-scoping all data), an **"add existing account to this org"** form on the org's members view, and a **member list** that renders the membership-based data from plan 3. Single-org users see no switcher (inert). This is the highest-review-surface piece and depends on plans 2–3 being live.

**Components delivered:**
- `web/src/` — an active-org switcher control (header/nav) backed by `listMyOrgs` + `setActiveOrg`, invalidating org-scoped queries on switch.
- `web/src/` — an org members page/section: the membership-based member list + an "add existing account" form calling `addExistingUserToOrg`, surfacing the CONFLICT/NOT_FOUND messages.

**Deferred to later plans in this spec:**
- None — this is the final plan.

---

## Spec ACs satisfied by this plan

- Spec AC #3 (enumerate orgs + select active; data scoped) — **partial** (the switcher UI; the API + scoping are plan 2).
- Spec AC #5 (member list shows all org members) — **partial** (rendering; the membership listing API is plan 3).
- Spec AC #9 (switcher visible to multi-org users, hidden/inert for single-org) — **full** `[manual]` for visual presence (the scoping behavior is AC #3).
- Also serves Spec AC #1 (admin can add an existing account) — the dashboard form is the UX affordance over plan 3's API.

---

## Depends On

- Plan 3 (management) — `addExistingUserToOrg`, membership-based member list, graceful CONFLICT messages.
- Plan 2 (access) — `listMyOrgs`, `setActiveOrg`, per-org role/effective-org scoping.

---

## Detailed Task List (TDD)

### 1. Active-org state + switcher data wiring

**Tests first** (`tests/unit/web/org-switcher.test.ts`):
- `switcher lists the user's orgs from listMyOrgs` — unit (mock trpc) — renders/returns the membership orgs. Expected red: hook/component-not-found.
- `selecting an org calls setActiveOrg with that orgId` — unit — Expected red: not-found.
- `after a successful switch, org-scoped queries are invalidated/refetched` — unit — assert the query client invalidation is triggered. Expected red: not-found / no invalidation.
- `a single-org user's switcher is inert (no selectable alternatives)` — unit — one membership → no switch action. Expected red: not-found.

**Implementation** (`web/src/`):
- An active-org hook/component using `trpc.<...>.listMyOrgs` + `setActiveOrg`; on switch, persist + invalidate org-scoped queries (projects, runs, users…). Default selection = current effective org.

### 2. Add-existing-account-to-org form

**Tests first** (`tests/unit/web/add-to-org-form.test.ts`):
- `submitting email + role calls addExistingUserToOrg for the current org` — unit — Expected red: form-not-found.
- `a NOT_FOUND (no such account) surfaces a clear message, not a crash` — unit — Expected red: not-found / unhandled.
- `a CONFLICT (already a member) surfaces the actionable message` — unit — Expected red: not-found / unhandled.

**Implementation** (`web/src/`):
- A form in the org members view: email + role → `addExistingUserToOrg`; renders the typed error envelopes (NOT_FOUND / CONFLICT) inline.

### 3. Membership-based member list

**Tests first** (`tests/unit/web/org-members-list.test.ts`):
- `renders every member of the org with their per-org role` — unit — including a member whose home org differs. Expected red: list-not-found / shows global role.

**Implementation** (`web/src/`):
- Render the membership-based list from plan 3 (user + per-org role); used by the org members view.

---

## Test Plan

### Unit tests
- [ ] `org-switcher.test.ts`: ~4 — list/select/invalidate/inert.
- [ ] `add-to-org-form.test.ts`: ~3 — submit + error envelopes.
- [ ] `org-members-list.test.ts`: ~1 — membership rendering.

### Integration tests
- [ ] n/a at the UI layer beyond the component tests (backend round-trips covered in plans 2–3).

### Acceptance tests
- [ ] Per-plan ACs below (switcher behavior, form, member list) — AC #9 via Manual Verification.

---

## Manual Verification (for `[manual]`-tagged ACs only)

- **AC**: per-plan AC #4 (spec AC #9) — the org switcher is visible/placed for a multi-org user and absent/inert for a single-org user.
- **Why manual**: visual presence + placement of a UI control is a rendering check, not an automatable behavioral assertion (the *scoping behavior* it drives is auto-tested under AC #1/#2 here and spec AC #3 in plan 2).
- **Verification protocol**:
  1. Log in as a user with memberships in ≥2 orgs → the org switcher control is present in the dashboard header/nav and lists those orgs; selecting another org changes the visible data set (projects/runs reflect the new org).
  2. Log in as a single-org user → no switcher control (or a disabled, non-interactive indicator) is shown; no org-selection affordance appears.

---

## Acceptance Criteria (per-plan, testable)

1. The switcher lists the user's orgs and, on selection, calls `setActiveOrg` and refetches org-scoped data so the new org's data is shown.
2. The add-to-org form submits email + role to `addExistingUserToOrg` for the current org and renders NOT_FOUND / CONFLICT envelopes inline (no crash).
3. The org members list renders every member of the org with their per-org role, including cross-home members.
4. `[manual]` — the switcher is visible/active for multi-org users and absent/inert for single-org users (see Manual Verification).
5. All new/modified code has tests; `npm run build` (incl. `web/`), `npm test`, `npm run lint`, `npm run typecheck` (incl. `web/`) pass.
6. Documentation listed below is updated.

---

## Documentation Impact (this plan only)

| File | Change |
|---|---|
| `README.md` | Users/organizations section: switching the active org + adding an existing account to an org from the dashboard. |
| `CHANGELOG.md` | Entry: "Dashboard: org switcher, add-existing-account-to-org form, membership-based member list." |

---

## Out of Scope (this plan)

- Email invitation UI (spec out of scope).
- Removing `users.org_id`.
- Sub-org/team/project-scoped role UI.

---

## Progress

<!-- /implement updates these as it works. Do not edit manually. -->
- [ ] AC #1
- [ ] AC #2
- [ ] AC #3
- [ ] AC #4
- [ ] AC #5
- [ ] AC #6
