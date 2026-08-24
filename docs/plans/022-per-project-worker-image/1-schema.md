---
id: 022
slug: per-project-worker-image
plan: 1
plan_slug: schema
level: plan
parent_spec: docs/specs/022-per-project-worker-image.md
depends_on: []
status: pending
---

# 022/1: Per-project worker-image schema + config plumbing

> Part 1 of 4 in the 022-per-project-worker-image plan. See [parent spec](../../specs/022-per-project-worker-image.md).

## Summary

The foundation: add the per-project worker-image fields to the `projects` table and thread them through the
config layer so the rest of the system can read them. Ships **dormant** — the columns exist and round-trip
through `ProjectConfig`, but nothing resolves or launches against them yet (plan 2 wires spawn; plan 3 wires
set/validation; plan 4 wires the UI).

Four nullable columns model the lifecycle a per-project image moves through: the operator's reference, the
resolved immutable digest, the validation status, and a failure reason. `NULL` everywhere = "no per-project
image", i.e. byte-for-byte current behavior. This mirrors the existing per-project-scalar pattern
(`watchdog_timeout_ms`, `model`, `agent_engine`, `snapshot_enabled`).

**Components delivered:**
- `src/db/migrations/0056_project_worker_image.sql` + `src/db/migrations/meta/_journal.json` entry — four nullable columns.
- `src/db/schema/projects.ts` — the four Drizzle columns.
- `src/config/schema.ts` — `ProjectConfigSchema` optional fields (no `.default()`).
- `src/config/configMapper.ts` — `NULL → undefined` mapping into `ProjectConfig`.
- `src/types/index.ts` — `ProjectConfig` type fields.
- `src/db/repositories/projectsRepository.ts` — select + write the four fields on read/create/update.

**Deferred to later plans in this spec:**
- Reading the fields at spawn time + the `effectiveBaseImage` correctness fix (plan 2).
- Setting/validating the image (CLI/API + validation job) (plan 3).
- Dashboard UI (plan 4).

---

## Spec ACs satisfied by this plan

- Spec AC #2 (set/clear round-trips through CLI + API + dashboard) — **partial** (this plan provides the
  storage/config round-trip; CLI/API in plan 3, dashboard in plan 4).

---

## Depends On

- None (Layer 0).

---

## Detailed Task List (TDD)

### 1. Migration — four nullable columns

**Tests first** (`tests/integration/db/projectsRepository.test.ts`):
- `projects row accepts NULL worker-image columns and reads them back as null/undefined` — integration — insert a project with no worker-image fields → read → all four are null. Expected red: `error: column "worker_image" does not exist` (migration not applied).
- `projects row round-trips all four worker-image fields` — integration — insert with `workerImage`, `workerImageDigest`, `workerImageStatus='verified'`, `workerImageError=null` → read back identical. Expected red: `column "worker_image" does not exist`.

**Implementation** (`src/db/migrations/0056_project_worker_image.sql`, `meta/_journal.json`):
- `ALTER TABLE projects ADD COLUMN worker_image text;` plus `worker_image_digest text`, `worker_image_status text`, `worker_image_error text` — all nullable, no default.
- Add the journal entry (unique `when` ms, `tag: "0056_project_worker_image"`) per the hand-written-SQL migration contract in CLAUDE.md.

### 2. Drizzle schema

**Tests first** (`tests/unit/db/schema/projects-worker-image.test.ts`):
- `projects schema exposes the four worker-image columns with correct snake_case names` — unit — assert the Drizzle table has `workerImage`/`worker_image` … through `workerImageError`/`worker_image_error`. Expected red: `expected property 'workerImage' to be defined`.

**Implementation** (`src/db/schema/projects.ts`):
- Add `workerImage: text('worker_image')`, `workerImageDigest: text('worker_image_digest')`, `workerImageStatus: text('worker_image_status')`, `workerImageError: text('worker_image_error')` (all nullable).

### 3. Config schema + type

**Tests first** (`tests/unit/config/project-config-worker-image.test.ts`):
- `ProjectConfigSchema parses worker-image fields when present` — unit — parse `{ workerImage:'r', workerImageDigest:'sha256:…', workerImageStatus:'verified' }` → fields preserved. Expected red: `expected workerImage to be 'r', got undefined` (schema strips unknown key).
- `ProjectConfigSchema omits worker-image fields when absent (no default injected)` — unit — parse `{}` → the four fields are `undefined`, NOT a literal. Expected red: passes only after fields added; pins that **no `.default()`** is used. Expected red before impl: `expected property workerImage to exist on the schema's output type` (via a type/parse assertion).
- `workerImageStatus only accepts pending|verified|failed` — unit — parse `{ workerImageStatus:'bogus' }` → ZodError. Expected red: `expected ZodError, got parsed value`.

**Implementation** (`src/config/schema.ts`, `src/types/index.ts`):
- `workerImage: z.string().optional()`, `workerImageDigest: z.string().optional()`, `workerImageStatus: z.enum(['pending','verified','failed']).optional()`, `workerImageError: z.string().optional()` — **no `.default()`** on any (unset must stay unset).
- Mirror the four optional fields on the `ProjectConfig` type.

### 4. configMapper + repository read/write

**Tests first** (`tests/unit/config/configMapper-worker-image.test.ts`, extend `tests/integration/db/projectsRepository.test.ts`):
- `configMapper maps NULL worker-image columns to undefined` — unit — DB row with nulls → `ProjectConfig` fields undefined (not null). Expected red: `expected undefined, got null`.
- `configMapper passes through populated worker-image columns` — unit — Expected red: `expected workerImage 'r', got undefined`.
- `projectsRepository.update persists and returns worker-image fields` — integration — update a project setting `workerImage`+`workerImageStatus='pending'` → re-read returns them. Expected red: `expected workerImage 'r', got undefined` (repository select/write omits the columns).

**Implementation** (`src/config/configMapper.ts`, `src/db/repositories/projectsRepository.ts`):
- In `buildBaseProjectFields` (or equivalent), map each column with `?? undefined`.
- In the repository's create/update column maps and the select projection, include the four fields.

---

## Test Plan

### Unit tests
- [ ] `projects-worker-image.test.ts`: ~1 — Drizzle column presence.
- [ ] `project-config-worker-image.test.ts`: ~3 — schema parse + enum + no-default.
- [ ] `configMapper-worker-image.test.ts`: ~2 — NULL→undefined + passthrough.

### Integration tests
- [ ] `projectsRepository.test.ts` (extended): ~3 — null round-trip, full round-trip, update persistence.

### Acceptance tests
- [ ] Per-plan ACs below.

---

## Manual Verification (for `[manual]`-tagged ACs only)

*n/a — all ACs auto-tested.*

---

## Acceptance Criteria (per-plan, testable)

1. The migration adds four nullable `worker_image*` columns to `projects` and applies cleanly via
   `npm run db:migrate`; an existing project with no values reads back all-null.
2. `ProjectConfigSchema` parses the four fields when present and leaves them `undefined` when absent (no
   `.default()`); `workerImageStatus` rejects values outside `pending|verified|failed`.
3. `configMapper` maps `NULL` columns to `undefined` on `ProjectConfig`, and the repository persists +
   returns the fields on create/update.
4. The fields are **dormant**: no spawn, resolution, validation, or UI code reads them yet (partial-state).
5. All new/modified code has tests; `npm run build`, `npm test`, `npm run test:integration`, `npm run lint`,
   `npm run typecheck` pass.
6. Documentation listed below is updated.

**Partial-state criterion:** the four `worker_image*` columns exist and round-trip through `ProjectConfig`,
but no application code reads them — reviewable in isolation as a schema+config change.

---

## Documentation Impact (this plan only)

| File | Change |
|---|---|
| _none_ | Dormant schema change; no user-facing docs. Operator-facing docs land with the config surface (plan 3) and UI (plan 4). |

---

## Out of Scope (this plan)

- Spawn-time resolution + `effectiveBaseImage` correctness fix (plan 2).
- Set/validate flow + validation job + CLI/API (plan 3).
- Dashboard UI (plan 4).
- Building images from a Dockerfile, declarative extras, per-agent images, private-registry creds (spec Out of Scope).

---

## Progress

<!-- /implement updates these as it works. Do not edit manually. -->
- [ ] AC #1
- [ ] AC #2
- [ ] AC #3
- [ ] AC #4
- [ ] AC #5
- [ ] AC #6
