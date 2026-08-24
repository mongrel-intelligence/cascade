---
id: 024
slug: shared-board-repo-topologies
plan: 1
plan_slug: schema-and-resolver-seam
level: plan
parent_spec: docs/specs/024-shared-board-repo-topologies.md
depends_on: []
status: pending
---

# 024/1: Schema, config field, and the project-resolution seam

> Part 1 of 5 in the 024-shared-board-repo-topologies plan. Parent spec: resolve `docs/specs/024-shared-board-repo-topologies.md*` (it may have been renamed `.done`).

## Summary

Foundation layer — everything here is dormant until plans 2–4 consume it. Delivers: (a) the DB migration replacing the repo-uniqueness constraint with a DB-enforced "exactly one primary project per repo" rule; (b) the optional `routing` discriminator field on the JIRA integration config schema; (c) a pure, provider-generic **project-routing resolver module** with the full outcome matrix (route / default / no-match skip / ambiguous skip) as unit-tested data-in-data-out logic; (d) payload-aware lookup APIs on the config provider + cache (`findProjectsByJiraProjectKey` plural, `getPrimaryProjectByRepo`, `findProjectIdByRepoPr`) with the existing singular APIs preserved as delegating wrappers so current callers are byte-identical.

Ships no behavior change: routing still uses the old lookups until plans 2/4 rewire them. Value: unlocks three parallel plans (2, 3, 4).

**Components delivered:**
- Migration `0061` + drizzle schema change (`repo_primary` column, index swap)
- `routing.discriminator` field on `jiraConfigSchema`
- New pure module `src/integrations/pm/_shared/project-routing.ts`
- New lookup functions in `src/config/provider.ts` / `src/config/configCache.ts` / `src/db/repositories/projectsRepository.ts` / `src/db/repositories/prWorkItemsRepository.ts`

**Files owned (exclusive to this plan within this spec):**
- `src/db/migrations/0061_repo_primary_topology.sql`
- `src/db/migrations/meta/_journal.json` (new entry)
- `src/db/schema/projects.ts`
- `src/integrations/pm/jira/config-schema.ts`
- `src/integrations/pm/_shared/project-routing.ts` (new)
- `src/config/provider.ts`, `src/config/configCache.ts`
- `src/db/repositories/projectsRepository.ts`, `src/db/repositories/prWorkItemsRepository.ts`
- `tests/unit/integrations/pm-project-routing.test.ts` (new)
- `tests/unit/config/provider-topology.test.ts` (new)

**Shared surfaces (append-only, conflicts are trivial):**
- none for this plan

**Deferred to later plans in this spec:**
- Wiring the resolver into JIRA event routing + save validation (plan 2)
- JQL scoping and work-item stamping (plan 3)
- GitHub link-first routing + friendly repo validation errors (plan 4)
- Wizard/UI fields (plan 5)

---

## Spec ACs satisfied by this plan

- Spec AC #1 (repo save accepted/rejected cleanly) — **partial (this plan provides the `repo_primary` column and DB constraint; plan 4 provides the friendly validation behavior)**
- Spec AC #2–#5 (discriminator routing outcomes) — **partial (this plan provides the resolver's decision logic; plan 2 wires it to events)**
- Spec AC #8–#10 (link-first, primary fallback, one-primary rule) — **partial (this plan provides the lookups and DB-enforced uniqueness; plan 4 provides routing behavior and errors)**
- Spec AC #12 (single-project behavior identical) — **partial (delegating wrappers keep all existing callers unchanged; pinned per-plan below)**

---

## Depends On

- Nothing in this spec. Requires a dev Postgres for the migration (`npm run test:db:up`).

---

## Detailed Task List (TDD)

### 1. Migration + drizzle schema: `repo_primary`

**Tests first** (`tests/unit/config/provider-topology.test.ts` — schema-shape assertions only; migration itself is verified by `npm run db:migrate` against the ephemeral test DB, per repo convention of no per-migration unit tests):

- `projects schema exposes repoPrimary defaulting true` — unit — import `projects` from `src/db/schema/index.js`, assert `repoPrimary` column exists, `notNull`, default `true`. Expected red: `TypeError: Cannot read properties of undefined (reading 'notNull')` (column absent).
- `projects.repo no longer declares column-level unique` — unit — inspect drizzle column config for `repo`, assert `isUnique !== true`. Expected red: `AssertionError: expected true to not be true` (`.unique()` still present).

**Implementation** (`src/db/migrations/0061_repo_primary_topology.sql`, `src/db/migrations/meta/_journal.json`, `src/db/schema/projects.ts`):
- SQL (hand-written per CLAUDE.md migration convention):
  ```sql
  ALTER TABLE projects ADD COLUMN repo_primary boolean NOT NULL DEFAULT true;
  DROP INDEX IF EXISTS uq_projects_repo;
  CREATE UNIQUE INDEX uq_projects_repo_primary ON projects (repo) WHERE repo IS NOT NULL AND repo_primary;
  ```
  Forward-compatible: every existing row gets `repo_primary=true`; since repos are currently unique, the new partial index is satisfied without data changes.
- `_journal.json`: append entry, unique `when` ms, `tag: "0061_repo_primary_topology"`.
- `src/db/schema/projects.ts`: remove `.unique()` from `repo` (line 14); add `repoPrimary: boolean('repo_primary').notNull().default(true)`.

### 2. JIRA config schema: routing discriminator

**Tests first** (extend `tests/unit/integrations/pm-conformance.test.ts` config-round-trip is automatic; add explicit shape tests in `tests/unit/integrations/pm-project-routing.test.ts`):

- `jiraConfigSchema accepts routing.discriminator label` — unit — parse config with `routing: { discriminator: { kind: 'label', value: 'team-be' } }` → success, value preserved on round-trip. Expected red: `ZodError: Unrecognized key(s) in object: 'routing'` (strict schema without the field) or field stripped on round-trip.
- `jiraConfigSchema accepts routing.discriminator component` — unit — same with `kind: 'component'`. Expected red: as above.
- `jiraConfigSchema rejects unknown discriminator kind` — unit — `kind: 'sprint'` → ZodError naming the enum. Expected red: parse unexpectedly succeeds (`expected parse to throw`).
- `jiraConfigSchema without routing still parses (backward compat)` — unit — existing fixture parses unchanged. Expected red: n/a — must be green from the start; guards AC #12 regression during this plan.

**Implementation** (`src/integrations/pm/jira/config-schema.ts`):
- Add optional field:
  ```ts
  routing: z.object({
    discriminator: z.object({
      kind: z.enum(['label', 'component']),
      value: z.string().min(1),
    }),
  }).optional()
  ```
- Update `jiraManifest.configFixture` (same file owns the schema; the fixture lives in `src/integrations/pm/jira/manifest.ts` — read-only here; extend the fixture only if the conformance round-trip requires the field present, otherwise leave untouched).

### 3. Pure resolver module

**Tests first** (`tests/unit/integrations/pm-project-routing.test.ts`):

- `single sibling routes unconditionally` — unit — one sibling, no discriminator; issue with arbitrary labels → `{action:'route', projectId}`. Expected red: `Cannot find module '../../src/integrations/pm/_shared/project-routing.js'`.
- `discriminated sibling wins on label match` — unit — siblings A(label team-be), B(no discriminator); issue labels `['team-be']` → route A. Expected red: module missing, then `expected 'route' A got B` if default wrongly preferred.
- `component discriminator matches issue components` — unit — sibling A(component Backend); issue components `['Backend']` → route A. Expected red: `expected action 'route', got 'skip'`.
- `no match with default routes to default` — unit — A(label team-be), B(none); issue labels `[]` → route B. Expected red: `expected projectId B, got skip/no_match`.
- `no match without default skips with reason no_match naming evaluated discriminators` — unit — A(label x), B(component y); issue matches neither → `{action:'skip', reason:'no_match'}`, message contains both discriminator values and the project ids. Expected red: `expected action 'skip', got 'route'`.
- `two matches skip ambiguous listing candidates` — unit — A(label t1), B(label t2); issue labels `['t1','t2']` → `{action:'skip', reason:'ambiguous', candidates:[A,B]}`. Expected red: `expected reason 'ambiguous', got 'route'`.
- `two discriminator-less siblings with unmatched issue skip ambiguous` — unit — misconfigured runtime state degrades loudly, never picks silently. Expected red: `expected 'skip', got 'route'`.
- `mixed kinds discriminate independently` — unit — A(label t1), B(component Backend); issue labels `['t1']`, components `['Backend']` → ambiguous. Expected red: wrong single route.

**Implementation** (`src/integrations/pm/_shared/project-routing.ts` — new, pure, no imports beyond types):
- ```ts
  export type PMRoutingDiscriminator = { kind: 'label' | 'component'; value: string };
  export type PMRoutingSibling = { projectId: string; discriminator: PMRoutingDiscriminator | null };
  export type PMRoutingIssueAttributes = { labels: readonly string[]; components: readonly string[] };
  export type PMRoutingOutcome =
    | { action: 'route'; projectId: string }
    | { action: 'skip'; reason: 'no_match' | 'ambiguous'; message: string; candidateProjectIds: string[] };
  export function resolveProjectAmongSiblings(
    siblings: readonly PMRoutingSibling[],
    issue: PMRoutingIssueAttributes,
  ): PMRoutingOutcome
  ```
- Rules (in order): 1 sibling → route it. Else compute discriminator matches (label ∈ issue.labels / component ∈ issue.components, exact case-sensitive match — JIRA labels are case-sensitive). Exactly 1 match → route. >1 → ambiguous. 0 matches → exactly one discriminator-less sibling → route it; zero or several discriminator-less → skip (`no_match` / `ambiguous` respectively). Messages are operator-readable and name every evaluated discriminator + project id (these become webhook decision reasons in plan 2).

### 4. Payload-aware lookups (provider, cache, repositories)

**Tests first** (`tests/unit/config/provider-topology.test.ts`, mocking the repositories layer with `vi.mock` per existing provider tests' pattern):

- `findProjectsByJiraProjectKey returns all siblings` — unit — repo mock returns two projects with same key → both returned, stable order by project id. Expected red: `TypeError: findProjectsByJiraProjectKey is not a function`.
- `findProjectByJiraProjectKey (legacy) still returns first match` — unit — delegates to plural, returns element 0 — pins AC #12 (existing callers unchanged). Expected red: n/a green-from-start guard.
- `getPrimaryProjectByRepo returns the repo_primary sibling` — unit — mock two projects sharing repo, one primary → primary returned. Expected red: function missing.
- `getProjectByRepo (legacy) delegates to primary lookup` — unit — same fixture → same result as `getPrimaryProjectByRepo`; single-project fixture → identical to today. Expected red: function missing / wrong sibling.
- `findProjectIdByRepoPr returns linked project` — unit — prWorkItems repo mock `(repoFullName,prNumber)→projectId` → returned; miss → null. Expected red: `findProjectIdByRepoPr is not a function`.

**Implementation**:
- `src/db/repositories/projectsRepository.ts`: add `findProjectsByJiraProjectKeyFromDb(projectKey): Promise<ProjectRow[]>` (existing singular keeps its signature, reimplemented as `(await plural)[0] ?? null`); add `findPrimaryProjectByRepoFromDb(repo)` (`WHERE repo = $1 AND repo_primary`) and `findProjectsByRepoFromDb(repo)`.
- `src/db/repositories/prWorkItemsRepository.ts`: add `findProjectIdByRepoPr(repoFullName: string, prNumber: number): Promise<string | null>` — select `project_id` where both match, newest row wins on duplicates.
- `src/config/provider.ts` + `src/config/configCache.ts`: expose `findProjectsByJiraProjectKey`, `getPrimaryProjectByRepo`, `findProjectIdByRepoPr`; cache keys stay per-identifier with the value now the sibling list (repo) — legacy `getProjectByRepo` / `findProjectByJiraProjectKey` become thin delegates preserving exact current return semantics for the single-project case.

---

## Test Plan

### Unit tests
- [ ] `tests/unit/integrations/pm-project-routing.test.ts`: ~10 tests covering schema field + full resolver outcome matrix
- [ ] `tests/unit/config/provider-topology.test.ts`: ~7 tests covering new lookups + legacy-delegation pins

### Integration tests
- [ ] `npm run db:migrate` applies 0061 cleanly on the ephemeral test DB (covered by the pre-push integration run booting migrations)

### Acceptance tests
- [ ] Per-plan ACs 1–5 below map 1:1 onto the unit suites

---

## Manual Verification

n/a — all ACs auto-tested.

---

## Acceptance Criteria (per-plan, testable)

1. Migration 0061 applies on a DB at 0060 with zero data changes required; every existing project ends `repo_primary=true` and the old `uq_projects_repo` index is gone.
2. `jiraConfigSchema` round-trips a config with and without `routing.discriminator`; unknown kinds are rejected.
3. `resolveProjectAmongSiblings` passes the full outcome matrix (route / discriminated / default / no_match / ambiguous / mixed kinds).
4. New lookups return sibling lists / primary / PR-link results; legacy `getProjectByRepo` and `findProjectByJiraProjectKey` return byte-identical results for single-project fixtures (AC #12 pin).
5. All new/modified code has corresponding tests.
6. `npm run typecheck` passes.
7. `npm test` passes.
8. `npm run lint` passes.

**Partial-state criterion:**
- `repo_primary`, `routing.discriminator`, and all new lookups exist with **zero callers** outside tests — reviewable in isolation; routing behavior is unchanged until plans 2/4.

---

## Documentation Impact (this plan only)

| File | Change |
|---|---|
| — | none; the routing-contract documentation lands with the behavior in plans 2/3 |

---

## Out of Scope (this plan)

- Any change to event routing behavior (plans 2, 4)
- JQL scoping / stamping (plan 3), UI (plan 5)
- Save-time validation messages (plans 2, 4)
- Trello/Linear discriminators (spec out-of-scope)

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
