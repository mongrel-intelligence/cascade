---
id: 024
slug: shared-board-repo-topologies
plan: 4
plan_slug: github-link-first-routing
level: plan
parent_spec: docs/specs/024-shared-board-repo-topologies.md
depends_on: [1-schema-and-resolver-seam.md]
status: pending
---

# 024/4: GitHub link-first routing and repo-sharing validation

> Part 4 of 5 in the 024-shared-board-repo-topologies plan. Parent spec: resolve `docs/specs/024-shared-board-repo-topologies.md*`.

## Summary

Makes repository sharing work and safe. Routing: the GitHub router adapter resolves the project **link-first** — a PR with a persisted `pr_work_items` link routes to the linked project regardless of how many projects share the repo — falling back to the repo's **primary** project for unlinked events (human-authored PRs, `pr-opened`). Validation: saving a repo already owned by another project stops being a raw 500 — `projects.create`/`projects.update` gain a `repoPrimary` input and reject conflicting configurations with a message naming the conflicting project, both via pre-check and via a friendly mapping of the DB unique-violation race.

File-disjoint from plans 2/3 (owns the GitHub adapter and the projects API router). Completes spec ACs #1, #8, #9, #10 together with plan 1's schema.

**Components delivered:**
- Link-first resolution in the GitHub router adapter with primary-project fallback
- `repoPrimary` input on project create/update + friendly duplicate-repo validation (pre-check + unique-violation mapping)
- Regression pins: unshared repos route and validate exactly as today

**Files owned (exclusive to this plan within this spec):**
- `src/router/adapters/github.ts`
- `src/api/routers/projects.ts`
- `tests/unit/router/github-project-routing.test.ts` (new)
- `tests/unit/api/routers/projects-repo-validation.test.ts` (new)

**Shared surfaces (append-only, conflicts are trivial):**
- none for this plan

**Deferred to later plans in this spec:**
- Dashboard primary toggle + error surfacing (plan 5)

---

## Spec ACs satisfied by this plan

- Spec AC #1 (repo save accepted under primary rule / rejected with named conflict, never a generic error) — **partial (plan 1 provides the column+index; this plan provides the behavior)** — completes
- Spec AC #8 (link-first routing) — **partial (plan 1 provides `findProjectIdByRepoPr`; this plan wires it)** — completes
- Spec AC #9 (unlinked events → primary) — **partial (with plan 1)** — completes
- Spec AC #10 (exactly-one-primary enforced with clear errors) — **partial (plan 1 DB-enforces; this plan makes it friendly)** — completes
- Spec AC #12 (single-project identical) — **partial (explicit pins below)**

---

## Depends On

- Plan 1 (`schema-and-resolver-seam`) — provides `repo_primary` column + partial unique index, `getPrimaryProjectByRepo`, `findProjectIdByRepoPr`.

---

## Detailed Task List (TDD)

### 1. Link-first resolution in the GitHub router adapter

Current behavior: `resolveProject` (`src/router/adapters/github.ts:268`) resolves via repo full name only (`repository.full_name` extracted at `:191`).

**Tests first** (`tests/unit/router/github-project-routing.test.ts`; mock the provider lookups per existing router-adapter test patterns; events built with `repository.full_name` + `pull_request.number` / `check_suite.pull_requests[].number`):

- `unshared repo resolves as today` — unit — one project owns the repo, event with or without a PR number → that project. Expected red: n/a green-from-start (AC #12 pin).
- `linked PR routes to linked project, not primary` — unit — two projects share the repo; `findProjectIdByRepoPr` returns the secondary's id → event resolves to the secondary. Expected red: `expected 'secondary', got 'primary'` (repo-only lookup still in place).
- `unlinked PR falls back to primary` — unit — link lookup returns null → primary project. Expected red: wrong project or throw.
- `event without a PR number routes to primary` — unit — e.g. a push-shaped payload with no PR context → primary, link lookup not called (spy). Expected red: `expected findProjectIdByRepoPr not to have been called`.
- `check-suite events use the suite's PR number for the link lookup` — unit — `check_suite.pull_requests[0].number` drives the lookup. Expected red: lookup called with undefined / wrong number.
- `link pointing at a deleted project falls back to primary` — unit — link returns an id absent from config → primary, with a warn log. Expected red: null project (event dropped).

**Implementation** (`src/router/adapters/github.ts`):
- In `resolveProject`: extract the event's PR number (reuse the adapter's existing extraction for `pull_request` / `check_suite` / `issue.pull_request` shapes — one helper if not already shared).
- Resolution order: (1) if a PR number exists → `findProjectIdByRepoPr(repoFullName, prNumber)`; a hit that maps to a live project wins; (2) otherwise / on miss → `getPrimaryProjectByRepo(repoFullName)` (plan 1's delegate keeps the single-project case identical).
- A link to a project no longer in config logs a warn (`[github-routing] stale pr link`, fields: repo, prNumber, linkedProjectId) and falls through to primary.

### 2. Friendly repo-sharing validation on project create/update

Current behavior: `projects.update` (`src/api/routers/projects.ts:595`) and `create` accept `repo` with no duplicate pre-check; the DB unique violation surfaces as a sanitized 500.

**Tests first** (`tests/unit/api/routers/projects-repo-validation.test.ts`; call the tRPC procedures with mocked repositories per the existing `tests/unit/api/` patterns):

- `saving an unused repo defaults to primary` — unit — no sibling rows → persisted with `repoPrimary: true`. Expected red: `repoPrimary` undefined in the write (input/plumbing missing).
- `saving a used repo as secondary succeeds` — unit — input `repoPrimary: false`, existing primary elsewhere → accepted, persisted `false`. Expected red: `TRPCError: BAD_REQUEST` or Zod unknown-key rejection.
- `saving a used repo without explicit repoPrimary is rejected with the owning project named` — unit — repo owned by project `frontend` → BAD_REQUEST whose message contains `frontend` and the repo name; **not** an INTERNAL_SERVER_ERROR. Expected red: mocked unique-violation bubbles as INTERNAL_SERVER_ERROR ("expected code BAD_REQUEST, got INTERNAL_SERVER_ERROR").
- `claiming primary while another primary exists is rejected naming it` — unit — input `repoPrimary: true`, sibling primary exists → BAD_REQUEST naming the sibling. Expected red: resolved instead of throwing.
- `demoting the only primary is rejected` — unit — update setting `repoPrimary: false` on the sole primary while secondaries exist → BAD_REQUEST ("would leave repo with no primary"). Expected red: resolved.
- `unique-violation race maps to the same friendly error` — unit — pre-check passes but the write throws a PG error with `code: '23505'` and the topology index name → BAD_REQUEST with the named-conflict message, not 500. Expected red: INTERNAL_SERVER_ERROR surfaced.
- `projects without repo unaffected` — unit — update with no `repo` field runs no topology checks (spy). Expected red: n/a green-from-start (AC #12 pin).

**Implementation** (`src/api/routers/projects.ts`):
- Input schemas (`create` ~:520, `update` ~:595): add `repoPrimary: z.boolean().optional()`.
- Shared local helper `assertRepoTopology(repo, repoPrimary, currentProjectId)` used by both procedures: load the repo's siblings — plan 1 deliberately did **not** ship a `findProjectsByRepoFromDb` (it would have been a zero-caller, zero-test export), so add it here in `configRepository.ts` over the existing `findProjectsFromDb` helper, where it gains its first caller and its tests in the same change; enforce — unused repo → default primary `true`; used repo → explicit `repoPrimary` required (reject with owning-project name otherwise); `repoPrimary: true` with an existing other primary → reject naming it; demotion leaving zero primaries while secondaries exist → reject. Messages are operator-actionable and name project ids.
- Wrap the persist call: catch PG `23505` on `uq_projects_repo_primary` and rethrow as the same BAD_REQUEST message (race-safety; the DB stays the authority).

---

## Test Plan

### Unit tests
- [ ] `tests/unit/router/github-project-routing.test.ts`: ~6 tests covering link-first order, fallbacks, stale links, single-project pin
- [ ] `tests/unit/api/routers/projects-repo-validation.test.ts`: ~7 tests covering the validation matrix + 23505 mapping + no-repo pin

### Integration tests
- [ ] none new — existing GitHub webhook integration suites stay green (single-project path untouched)

### Acceptance tests
- [ ] Per-plan ACs below map onto the two suites

---

## Manual Verification

n/a — all ACs auto-tested.

---

## Acceptance Criteria (per-plan, testable)

1. A GitHub event for a linked PR resolves to the linked project on shared repos; unlinked events resolve to the primary; unshared repos resolve exactly as before (pin).
2. Saving a duplicate repo yields BAD_REQUEST naming the owning project — via pre-check and via the 23505 race path — never a generic server error.
3. The primary invariant is enforced end-to-end: secondary saves succeed, double-primary and zero-primary configurations are rejected with actionable messages.
4. All new/modified code has corresponding tests.
5. `npm run typecheck` passes.
6. `npm test` passes.
7. `npm run lint` passes.

---

## Documentation Impact (this plan only)

| File | Change |
|---|---|
| — | none; SCM topology semantics are documented with the operator-facing UI in plan 5 |

---

## Out of Scope (this plan)

- Dashboard toggle and error display (plan 5)
- CLI flag for `repoPrimary` (not required by any spec AC; add on demand)
- PM-side behavior (plans 2/3); Trello/Linear (spec out-of-scope)

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
