---
id: 022
slug: per-project-worker-image
plan: 4
plan_slug: ui
level: plan
parent_spec: docs/specs/022-per-project-worker-image.md
depends_on: [3-set-validation.md]
status: pending
---

# 022/4: Dashboard worker-image control + operator walkthrough docs

> Part 4 of 4 in the 022-per-project-worker-image plan. See [parent spec](../../specs/022-per-project-worker-image.md).

> ⚠️ This plan touches `web/` and `docs/` only; follow the repo's normal push rules.

## Summary

The user-facing layer on top of the curl-testable backend: a project-settings control to set/clear the worker
image and see its validation state, plus the operator walkthrough docs. The control shows the global default
as a placeholder, accepts a reference, and reflects the `pending → verified → failed(reason)` lifecycle from
plan 3 (polling while pending, like the run-status views). It is visible/editable only to a superadmin,
mirroring the backend gate.

This is the final plan; after it the feature is complete end-to-end across CLI, API, and dashboard.

**Components delivered:**
- `web/src/components/projects/` — a Worker Image card/section in the project general settings (input + set +
  clear + status badge + failure reason + global-default placeholder), superadmin-gated, polling while pending.
- `docs/getting-started.md` — operator walkthrough: derive `FROM cascade-worker:<pinned>`, make it available
  (registry-backed and self-hosted/local), set it on a project, confirm verified — both topologies.

**Deferred to later plans in this spec:**
- None — final plan.

---

## Spec ACs satisfied by this plan

- Spec AC #2 (set/clear round-trips through CLI + API + dashboard) — **partial** (the dashboard surface; CLI/API are plan 3).
- Spec AC #10 (operator docs walkthrough, both topologies) — **full** `[manual]` (documentation/walkthrough check).
- Also surfaces Spec AC #4's verified/pending/failed state in the UI (the affordance over plan 3's state).

---

## Depends On

- Plan 3 (set-validation) — the `projects.update` mutation (workerImage + clear), the `defaults` query (global
  image), and the per-project `workerImageStatus` / `workerImageError` / `workerImageDigest` read fields.

---

## Detailed Task List (TDD)

### 1. Worker Image settings control

**Tests first** (`tests/unit/web/project-worker-image.test.tsx`):
- `renders the global default as placeholder when unset` — unit (mock trpc) — Expected red: `component/section not found`.
- `submitting a reference calls projects.update with workerImage` — unit — Expected red: `not-found / mutation not called`.
- `clear calls projects.update with workerImage null` — unit — Expected red: `not-found`.
- `shows pending state (verifying…) and polls while status is pending` — unit — `workerImageStatus='pending'` → a verifying indicator + a refetch is scheduled while pending. Expected red: `expected verifying indicator + refetch`.
- `shows verified state with the pinned digest` — unit — `status='verified'` → a verified badge + the digest. Expected red: `not-found`.
- `shows failed state with the error reason` — unit — `status='failed'`, `workerImageError='missing cascade-tools'` → a failure badge + the reason. Expected red: `expected failure reason rendered`.
- `the control is hidden/disabled for a non-superadmin` — unit — non-superadmin context → no editable control (mirrors the backend gate). Expected red: `expected control absent/disabled`.

**Implementation** (`web/src/components/projects/`):
- A Worker Image card in the project general settings (use the existing snapshot Card as the structural
  template): a text input (placeholder = global default from `defaults`), Set + Clear actions wired to
  `projects.update`, a status badge driven by `workerImageStatus` (verifying spinner while `pending`, ✓ + digest
  when `verified`, ✗ + `workerImageError` when `failed`), and superadmin-gated visibility. Invalidate/refetch
  the project query on mutation and poll while `pending` (reuse the run-status polling approach).

---

## Test Plan

### Unit tests
- [ ] `project-worker-image.test.tsx`: ~7 — placeholder, set, clear, pending+poll, verified, failed, superadmin gating.

### Integration tests
- [ ] n/a at the UI layer (backend round-trips covered in plan 3).

### Acceptance tests
- [ ] Per-plan ACs below; AC for the operator walkthrough via Manual Verification.

---

## Manual Verification (for `[manual]`-tagged ACs only)

- **AC**: per-plan AC #5 (spec AC #10) — operator docs walk from `FROM cascade-worker:<pinned>` → make-available
  → set-on-project → verified, in both topologies.
- **Why manual**: a documentation/walkthrough completeness check, not an automatable behavioral assertion.
- **Verification protocol**:
  1. Follow `docs/getting-started.md` on a **self-hosted/local** deployment: build a trivial image
     `FROM cascade-worker:local` adding one apt package; set it on a project via the dashboard; observe the
     status reach **verified** with a pinned digest; trigger a job and confirm the worker runs from the custom
     image (the added package is present in a shell command).
  2. Repeat the registry-backed variant: an image `FROM ghcr.io/mongrel-intelligence/cascade-worker:<pinned>`
     pushed to a host-reachable registry; set it; observe **verified**.
  3. Set a deliberately-broken image (e.g. `FROM alpine`); observe the status reach **failed** with a reason
     naming the missing requirement, and confirm no job launches on it.

---

## Acceptance Criteria (per-plan, testable)

1. The project settings show a Worker Image control with the global default as a placeholder when unset, and
   submitting a reference calls `projects.update`. *(AC2 partial)*
2. Clearing the control reverts the project to the global default. *(AC2 partial)*
3. The control reflects the lifecycle — verifying (polling) while `pending`, verified + digest, failed +
   reason — sourced from the per-project status fields. *(surfaces AC4 state)*
4. The control is visible/editable only to a superadmin. *(AC8 affordance)*
5. `[manual]` — operator docs walk through deriving a custom image from the cascade base, making it available,
   setting it, and confirming verified, in both topologies (see Manual Verification). *(AC10)*
6. All new/modified code has tests; `npm run build` (incl. `web/`), `npm test`, `npm run lint`,
   `npm run typecheck` (incl. `web/`) pass.
7. Documentation listed below is updated.

---

## Documentation Impact (this plan only)

| File | Change |
|---|---|
| `docs/getting-started.md` | Operator walkthrough: derive `FROM cascade-worker:<pinned>`, make it available (registry-backed + self-hosted local), set it on a project from the dashboard, confirm verified — both topologies. |
| `CHANGELOG.md` | Entry: "Dashboard: set/clear a project's worker image with live verified/pending/failed status." |

---

## Out of Scope (this plan)

- Building images from a Dockerfile, declarative extras, per-agent images, per-project registry credentials
  (spec Out of Scope).
- Any backend behavior (all delivered in plans 1–3).

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
