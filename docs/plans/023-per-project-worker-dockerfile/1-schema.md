---
id: 023
slug: per-project-worker-dockerfile
plan: 1
plan_slug: schema
level: plan
parent_spec: docs/specs/023-per-project-worker-dockerfile.md
depends_on: []
status: pending
---

# 023/1: Worker-Dockerfile schema + config plumbing

> Part 1 of 5 in the 023-per-project-worker-dockerfile plan. See [parent spec](../../specs/023-per-project-worker-dockerfile.md).

## Summary

The foundation. Add the two per-project columns a Dockerfile-built worker image needs, widen the worker-image
status vocabulary with a `building` state, and thread everything through the config layer so the rest of the
system can read it. Ships **dormant** — the columns exist and round-trip through `ProjectConfig`, but nothing
builds, resolves, or launches against them yet (plan 2 wires spawn, plan 3 the build engine, plan 4 the set
surfaces, plan 5 the UI).

This plan deliberately reuses spec 022's existing four `worker_image*` columns rather than duplicating them:
`worker_image` keeps holding a **referenced** image ref (null for a Dockerfile-sourced project),
`worker_image_digest` is widened in meaning to hold the launchable pin for the **active** image of either source
(a registry `repo@sha256` for a referenced image, or the immutable **local image ID** for a built one),
`worker_image_status` keeps meaning **"is there a runnable image, and may spawn launch it"** (`pending` |
`building` | `verified` | `failed`), and `worker_image_error` keeps holding the last failure reason. Three
genuinely new columns are added:

- `worker_dockerfile` — the operator's extra-layers content.
- `worker_image_build_hash` — the content-hash `sha256(composed Dockerfile bytes + resolved base digest)` of the
  operator's **desired** content; the rebuild-skip key and the async-result supersede guard.
- `worker_image_build_status` — the status of the most recent **(re)build attempt** (`building` | `failed`; null
  = idle/settled), **independent** of `worker_image_status`.

The third column is load-bearing for spec AC #9 (a failed rebuild never strands a project). It lets a rebuild of
a project that already has a last-good verified image run — and even fail — while `worker_image_status` stays
`verified` on the still-runnable active pin, so spawn keeps launching. Only a **first** build (no prior good
image) uses `worker_image_status = building/failed` (spawn correctly throws until it verifies). Without the split
column, a rebuild would have to flip the single status to `building`/`failed` and strand a project that was
running fine.

The project's effective image **source** is *derived*, not stored: `worker_dockerfile` set → `dockerfile`,
else `worker_image` set → `reference`, else `default`. Mutual exclusivity (enforced at set time in plan 4)
guarantees at most one of the two is ever non-null; the derivation defines a total precedence as a safety net.

**Components delivered:**
- `src/db/migrations/0059_project_worker_dockerfile.sql` + `src/db/migrations/meta/_journal.json` entry
- `src/db/schema/projects.ts` — three new columns
- `src/config/schema.ts` — `building` status value; `WorkerImageBuildStatusSchema`; `workerDockerfile`, `workerImageBuildHash`, `workerImageBuildStatus`, derived `workerImageSource` on `ProjectConfig`
- `src/db/repositories/configMapper.ts` — map the three columns + derive `workerImageSource`
- `src/db/repositories/projectsRepository.ts` — include the three columns in read/create/update

**Deferred to later plans in this spec:**
- Spawn resolution / launch-by-local-pin / reachability guard (plan 2)
- The router-side build engine (compose, build, content-hash, timeout, pin, smoke-test, GC) (plan 3)
- tRPC/CLI set surfaces, mutual-exclusivity enforcement, reject-`FROM`, audit, enqueue, manual rebuild (plan 4)
- Dashboard UI + docs (plan 5)

---

## Spec ACs satisfied by this plan

- Spec AC #2 (set/clear round-trips through CLI + API + dashboard) — **partial** (this plan provides the storage + config round-trip; plan 4 provides CLI/API, plan 5 the dashboard).
- Spec AC #3 (exactly one effective image source) — **partial** (this plan provides the derived `workerImageSource` with a total precedence; plan 4 enforces mutual exclusivity at set time).

---

## Depends On

- Nothing. Layer 0.

---

## Detailed Task List (TDD)

### 1. Migration + journal

**Tests first** (`tests/unit/db/schema/projects-worker-dockerfile.test.ts`):

- `migration 0059 adds the three worker-dockerfile columns as nullable text` — unit — parse the `0059_*.sql` file text → assert it contains `ADD COLUMN worker_dockerfile text`, `ADD COLUMN worker_image_build_hash text`, and `ADD COLUMN worker_image_build_status text`, all nullable (no `NOT NULL`). Expected red: `ENOENT: no such file or directory, open '.../0059_project_worker_dockerfile.sql'`.
- `journal has a 0059 entry with a unique when and matching tag` — unit — read `meta/_journal.json` → assert an entry `{ idx: 59, tag: '0059_project_worker_dockerfile' }` with a `when` strictly greater than the 0058 entry's. Expected red: `AssertionError: expected undefined to have property 'tag'`.

**Implementation** (`src/db/migrations/0059_project_worker_dockerfile.sql`):
- `ALTER TABLE projects ADD COLUMN worker_dockerfile text;` — operator's extra-layers content (nullable; null = not dockerfile-sourced).
- `ALTER TABLE projects ADD COLUMN worker_image_build_hash text;` — content-hash `sha256(composed Dockerfile bytes + resolved base digest)` of the desired content; null when not dockerfile-sourced.
- `ALTER TABLE projects ADD COLUMN worker_image_build_status text;` — most-recent (re)build attempt status (`building` | `failed`; null = idle/settled), independent of `worker_image_status`.
- Header comment block mirroring `0057_project_worker_image.sql`, documenting the reuse of `worker_image_digest` for the active local pin, the derived-source rule, and why `worker_image_build_status` is split from `worker_image_status`.
- Journal entry: `{ "idx": 59, "version": "<match sibling>", "when": 1794000000000, "tag": "0059_project_worker_dockerfile", "breakpoints": true }`.

### 2. Drizzle schema columns

**Tests first** (append to `tests/unit/db/schema/projects-worker-dockerfile.test.ts`):

- `projects schema exposes the three new dockerfile columns` — unit — import the drizzle `projects` table → assert `workerDockerfile`, `workerImageBuildHash`, `workerImageBuildStatus` column objects exist and map to their snake_case names. Expected red: `AssertionError: expected undefined (projects.workerDockerfile) to be defined`.

**Implementation** (`src/db/schema/projects.ts`, beside lines 40-43):
- `workerDockerfile: text('worker_dockerfile'),`
- `workerImageBuildHash: text('worker_image_build_hash'),`
- `workerImageBuildStatus: text('worker_image_build_status'),`

### 3. Config schema — status values + ProjectConfig fields + derived source

**Tests first** (`tests/unit/config/project-config-worker-dockerfile.test.ts`):

- `WorkerImageStatusSchema accepts 'building'` — unit — `WorkerImageStatusSchema.parse('building')` → returns `'building'`. Expected red: `ZodError: Invalid enum value. Expected 'pending' | 'verified' | 'failed', received 'building'`.
- `WorkerImageBuildStatusSchema accepts 'building' and 'failed' only` — unit — parses `'building'`/`'failed'`; rejects `'verified'`. Expected red: `ReferenceError: WorkerImageBuildStatusSchema is not defined`.
- `ProjectConfig carries workerDockerfile / workerImageBuildHash / workerImageBuildStatus as optional` — unit — parse a config object with all three set → round-trips; omitting them → still valid. Expected red: property missing / parse fails on the fixture including the fields.
- `workerImageSource is a 'default' | 'reference' | 'dockerfile' enum on ProjectConfig` — unit — parse a config with `workerImageSource: 'dockerfile'` → valid; `'bogus'` → throws. Expected red: `AssertionError: expected parse to reject 'bogus'`.

**Implementation** (`src/config/schema.ts`):
- Widen `WorkerImageStatusSchema` (line 28) to `z.enum(['pending', 'building', 'verified', 'failed'])`. Update the doc comment above it to describe `building`.
- Add `WorkerImageBuildStatusSchema = z.enum(['building', 'failed'])` with a doc comment (null/absent = idle/settled).
- On the `ProjectConfig` schema (beside lines 105-108): add `workerDockerfile: z.string().optional()`, `workerImageBuildHash: z.string().optional()`, `workerImageBuildStatus: WorkerImageBuildStatusSchema.optional()`, and `workerImageSource: z.enum(['default', 'reference', 'dockerfile']).optional()`.

### 4. Config mapper + repository

**Tests first** (`tests/unit/config/configMapper-worker-dockerfile.test.ts`):

- `configMapper maps worker_dockerfile / worker_image_build_hash NULL → undefined` — unit — map a DB row with both null → `workerDockerfile === undefined && workerImageBuildHash === undefined`. Expected red: `AssertionError: expected null to be undefined`.
- `configMapper derives workerImageSource = 'dockerfile' when worker_dockerfile is set` — unit — row `{ worker_dockerfile: 'RUN true', worker_image: null }` → `workerImageSource === 'dockerfile'`. Expected red: `AssertionError: expected undefined to equal 'dockerfile'`.
- `configMapper derives 'reference' when only worker_image is set` — unit — row `{ worker_dockerfile: null, worker_image: 'x/y:z' }` → `'reference'`. Expected red: `AssertionError: expected undefined to equal 'reference'`.
- `configMapper derives 'default' when neither is set` — unit — row both null → `'default'`. Expected red: `AssertionError: expected undefined to equal 'default'`.
- `configMapper precedence: dockerfile wins if both somehow set` — unit — row both set → `'dockerfile'` (safety-net precedence). Expected red: `AssertionError: expected undefined to equal 'dockerfile'`.

**Implementation** (`src/db/repositories/configMapper.ts`, beside lines 176-179 / 291-294):
- Map `worker_dockerfile → workerDockerfile`, `worker_image_build_hash → workerImageBuildHash`, and `worker_image_build_status → workerImageBuildStatus` (NULL → undefined), mirroring the existing `worker_image*` mapping.
- Add `deriveWorkerImageSource(row): 'default' | 'reference' | 'dockerfile'` — `row.worker_dockerfile != null ? 'dockerfile' : row.worker_image != null ? 'reference' : 'default'` — and set `workerImageSource` on the mapped config.

**Tests first** (`tests/integration/db/projectsRepository.test.ts` — extend):

- `create + read round-trips the three worker-dockerfile columns` — integration — insert a project with `workerDockerfile` / `workerImageBuildHash` / `workerImageBuildStatus` set → read back equal. Expected red: `AssertionError: expected undefined to equal 'RUN apt-get install -y jq'`.
- `update sets and clears worker_dockerfile` — integration — update to a value then to null → both observed. Expected red: column not present in the update set → `error: column "worker_dockerfile" ... ` or `AssertionError`.

**Implementation** (`src/db/repositories/projectsRepository.ts`, beside lines 50-53 / 79-82 / 112-115):
- Include `workerDockerfile`, `workerImageBuildHash`, and `workerImageBuildStatus` in the row read projection, the create insert, and the update set (all optional/nullable), mirroring the existing `worker_image*` handling.

---

## Test Plan

### Unit tests
- [ ] `tests/unit/db/schema/projects-worker-dockerfile.test.ts`: ~3 tests (migration text, journal entry, schema columns)
- [ ] `tests/unit/config/project-config-worker-dockerfile.test.ts`: ~4 tests (status enum, build-status enum, optional fields, source enum)
- [ ] `tests/unit/config/configMapper-worker-dockerfile.test.ts`: ~5 tests (null-mapping + source derivation matrix)

### Integration tests
- [ ] `tests/integration/db/projectsRepository.test.ts`: 2 tests (create/read round-trip, update set+clear)

### Acceptance tests
- [ ] Covered by per-plan AC #1–#3 below.

---

## Manual Verification (for `[manual]`-tagged ACs only)

n/a — all ACs auto-tested.

---

## Acceptance Criteria (per-plan, testable)

1. Migration `0059_project_worker_dockerfile.sql` exists, adds `worker_dockerfile` + `worker_image_build_hash` + `worker_image_build_status` as nullable text, and has a matching journal entry with a unique `when`; `npm run db:migrate` applies cleanly on a fresh DB.
2. `WorkerImageStatusSchema` accepts `building`; `WorkerImageBuildStatusSchema` accepts `building`/`failed`; `ProjectConfig` exposes `workerDockerfile`, `workerImageBuildHash`, `workerImageBuildStatus`, and a derived `workerImageSource` enum.
3. The config mapper maps all three columns (NULL → undefined) and derives `workerImageSource` with precedence `dockerfile > reference > default`; the repository round-trips all three columns on create/update/read.
4. All new/modified code has corresponding tests.
5. `npm run build` passes.
6. `npm test` passes (all four unit projects) and the extended `tests/integration/db/projectsRepository.test.ts` passes.
7. `npm run lint` and `npm run typecheck` pass.
8. All documentation listed in Documentation Impact has been updated.

**Partial-state criterion:**
- `worker_dockerfile`, `worker_image_build_hash`, and `worker_image_build_status` columns exist and round-trip through `ProjectConfig`; **no** application code builds, resolves, or launches against them yet — the columns are reviewable in isolation.

---

## Documentation Impact (this plan only)

| File | Change |
|---|---|
| `CHANGELOG.md` | Under Unreleased: "Added dormant `worker_dockerfile` / `worker_image_build_hash` / `worker_image_build_status` project columns + `building` worker-image status (foundation for per-project Dockerfile builds)." |

(README / getting-started operator docs land in plan 5 with the user-facing behavior.)

---

## Out of Scope (this plan)

- Any spawn/launch behavior against the new columns (plan 2).
- Any build machinery (plan 3).
- Mutual-exclusivity **enforcement**, reject-`FROM`, and set surfaces (plan 4) — this plan only *derives* the source and defines a safety-net precedence.
- Dashboard UI and operator docs (plan 5).
- Everything in the spec's Out of Scope (registry push / multi-host, build secrets, full arbitrary Dockerfiles, base-bump fan-out, cosign).

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
