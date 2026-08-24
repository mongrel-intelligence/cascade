---
id: 023
slug: per-project-worker-dockerfile
plan: 4
plan_slug: set-surfaces
level: plan
parent_spec: docs/specs/023-per-project-worker-dockerfile.md
depends_on: [3-build-engine.md]
status: pending
---

# 023/4: Operator set surfaces — tRPC + CLI, mutual exclusivity, reject-FROM, audit, enqueue, rebuild

> Part 4 of 5 in the 023-per-project-worker-dockerfile plan. See [parent spec](../../specs/023-per-project-worker-dockerfile.md).

## Summary

Make the build engine operator-reachable from the backend. A superadmin can set/clear a project's worker
Dockerfile content through the tRPC projects API and the `cascade projects` CLI (with a file/stdin form so a
multi-line block never has to be shell-escaped), and can trigger an explicit rebuild. Setting a Dockerfile is
**mutually exclusive** with referencing a prebuilt image (spec 022): choosing one clears the other, so a
project always resolves to exactly one effective image source.

This plan mirrors spec 022's set path verbatim — the per-field superadmin `FORBIDDEN` gate, the grep-stable
audit line, and the enqueue-a-router-job shape — and adds a Dockerfile-specific synchronous validator
(reject-`FROM`, size cap) plus the content-hash idempotency that skips a redundant rebuild on an identical
re-save. The set surface has **no Docker access**, so it computes only the Docker-free **content-hash**
(the column/job identity + supersede guard); the router resolves the base digest and does the real work.

After this plan the feature is **end-to-end curl-testable**: set a Dockerfile via the API → the router builds
and verifies it → a subsequent run for that project launches the built image.

**Components delivered:**
- `src/config/workerDockerfileContent.ts` — `validateWorkerDockerfileContent` + `WORKER_DOCKERFILE_MAX_BYTES`
- `src/api/routers/projects.ts` — `workerDockerfile` input on create/update; a `processWorkerDockerfileChange` helper (superadmin gate, validate, mutual-exclusivity, content-hash idempotency, audit, enqueue); a `rebuildWorkerImage` mutation; extend the existing `processWorkerImageChange` to clear Dockerfile columns when a reference is set (mutual exclusivity, other direction)
- `src/cli/dashboard/projects/update.ts` + `create.ts` — `--dockerfile-file <path>` (`-` = stdin) exclusive with `--worker-image`/`--clear-worker-image`; `--clear-dockerfile`; a `--rebuild-worker-image` action (or a sibling `rebuild-worker-image` command); `show.ts` renders Dockerfile presence + build status

**Deferred to later plans in this spec:**
- Dashboard textarea + building/failed rendering + rebuild button + operator docs (plan 5)

---

## Spec ACs satisfied by this plan

- Spec AC #2 (set/clear round-trips through CLI + API + dashboard) — **partial** (this plan provides CLI + API; plan 5 the dashboard).
- Spec AC #3 (exactly one effective image source; mutual exclusivity) — **full** (enforced here in both directions).
- Spec AC #4 (reject content that declares its own base at set time; nothing persisted on rejection) — **full**.
- Spec AC #6 (async build surfaced as building/verified/failed; supersede) — **partial** (this plan writes `building` + enqueues the superseding job and returns the status via the API; plan 5 renders it).
- Spec AC #8 (content-hash rebuild/reuse; explicit rebuild) — **partial** (this plan provides the identical-re-save no-op skip + the explicit rebuild trigger; plan 3 provides the engine reuse; plan 5 the button).
- Spec AC #10 (superadmin-only + audited) — **full**.
- Spec AC #11 (build gated to superadmin) — **partial** (this plan provides the superadmin gate on the set that enqueues the build; plans 2/3 cover launch/build posture + no-secrets).

---

## Depends On

- Plan 3 (build-engine) — provides `computeContentHash`, `enqueueWorkerImageBuildJob`, and the `worker-image-build` handler this plan enqueues to.
- Plan 1 (schema) — the three columns + statuses.

---

## Detailed Task List (TDD)

### 1. Synchronous content validator

**Tests first** (`tests/unit/config/worker-dockerfile-content.test.ts`):

- `rejects empty / whitespace-only content` — unit — `validateWorkerDockerfileContent('   ')` → `{valid:false, error:/empty/}`. Expected red: `TypeError: validateWorkerDockerfileContent is not a function`.
- `rejects content exceeding WORKER_DOCKERFILE_MAX_BYTES` — unit — a string over the cap → `{valid:false, error:/too large|max/}`. Expected red: `AssertionError: expected valid:false`.
- `rejects content that declares its own FROM (case-insensitive, any line)` — unit — `'RUN true\nFROM ubuntu'` and `'from scratch'` → `{valid:false, error:/FROM/}`. Expected red: `AssertionError: expected valid:false`.
- `accepts layers-only content` — unit — `'RUN apt-get update && apt-get install -y jq'` → `{valid:true}`. Expected red: `AssertionError: expected valid:true`.

**Implementation** (`src/config/workerDockerfileContent.ts`):
- `WORKER_DOCKERFILE_MAX_BYTES` const (a generous cap, e.g. 64 KiB — tuneable, not magic; documented).
- `validateWorkerDockerfileContent(content): { valid: boolean; error?: string }` — reject empty/whitespace, over-cap (byte length), and any line matching a `^\s*FROM\s` regex (case-insensitive). Otherwise valid. (Mirrors `workerImageRef.ts:isValidImageReference` as a config-owned helper.)

### 2. tRPC set/clear + mutual exclusivity + idempotency + audit + enqueue

**Tests first** (`tests/unit/api/routers/projects-worker-dockerfile.test.ts`):

- `non-superadmin cannot set workerDockerfile (FORBIDDEN)` — unit — `update({workerDockerfile:'RUN true'})` as a non-superadmin → `TRPCError FORBIDDEN`; nothing persisted. Expected red: `AssertionError: expected FORBIDDEN`.
- `invalid content is rejected BAD_REQUEST and nothing is persisted` — unit — `update({workerDockerfile:'FROM ubuntu'})` as superadmin → `TRPCError BAD_REQUEST`; the row's `worker_dockerfile` stays null. Expected red: `AssertionError: expected BAD_REQUEST`.
- `setting a Dockerfile writes content + building status + content-hash and enqueues a build` — unit — valid content → persists `worker_dockerfile`, `worker_image_build_hash = computeContentHash(content)`, `worker_image_build_status='building'`, and calls `enqueueWorkerImageBuildJob({projectId, buildHash})`. Expected red: `AssertionError: expected enqueueWorkerImageBuildJob to have been called`.
- `setting a Dockerfile clears a previously-referenced image (mutual exclusivity)` — unit — project has `worker_image` set + verified; set a Dockerfile → `worker_image` cleared to null (and its digest/status reset). Expected red: `AssertionError: expected worker_image to be null`.
- `setting a referenced image clears a previously-set Dockerfile (other direction)` — unit — project has `worker_dockerfile` set; set `workerImage` → `worker_dockerfile`, `worker_image_build_hash`, `worker_image_build_status` cleared. Expected red: `AssertionError: expected worker_dockerfile to be null`.
- `re-saving byte-identical content does NOT enqueue a rebuild` — unit — project already `worker_image_status='verified'` with `worker_image_build_hash = H`; set content whose hash is `H` → no `enqueueWorkerImageBuildJob` call, status stays `verified`. Expected red: `AssertionError: expected enqueue not to have been called`.
- `clearing the Dockerfile reverts to the global default and does not enqueue` — unit — `update({workerDockerfile:null})` → `worker_dockerfile`/build columns/active pin cleared; no enqueue. Expected red: `AssertionError: expected worker_dockerfile null and no enqueue`.
- `set emits the grep-stable audit line` — unit — spy the logger → an audit entry `event: 'project_worker_image_changed'` (or a dockerfile-specific event) with actorId/projectId/from/to is emitted before enqueue. Expected red: `AssertionError: expected audit line`.

**Implementation** (`src/api/routers/projects.ts`):
- Add `workerDockerfile: z.string().nullish()` to the create + update input (beside `workerImage`).
- `processWorkerDockerfileChange(opts)` mirroring `processWorkerImageChange:78`:
  - Superadmin gate (per-field `FORBIDDEN`).
  - `null` → clear `worker_dockerfile` + `worker_image_build_hash` + `worker_image_build_status`; if the project was dockerfile-sourced, also reset `worker_image_status`/`worker_image_digest`/`worker_image_error` (revert to default). No enqueue.
  - `string` → `validateWorkerDockerfileContent` (invalid → `BAD_REQUEST`, nothing persisted). Compute `contentHash`. **Mutual exclusivity:** clear `worker_image` + its digest. **Idempotency:** if `contentHash === existing worker_image_build_hash && worker_image_status === 'verified'` → no-op (keep verified image, no enqueue). Else persist `worker_dockerfile=content`, `worker_image_build_hash=contentHash`, `worker_image_build_status='building'`, `worker_image_status = priorVerified ? 'verified' : 'building'`, clear `worker_image_error`; emit the audit line; `enqueueWorkerImageBuildJob({projectId, buildHash: contentHash})`.
- Extend the existing `processWorkerImageChange` to clear `worker_dockerfile` + build columns whenever a non-null `workerImage` reference is set (mutual exclusivity, other direction).

### 3. Manual rebuild mutation

**Tests first** (append to `projects-worker-dockerfile.test.ts`):

- `rebuildWorkerImage requires superadmin` — unit — non-superadmin → `FORBIDDEN`. Expected red: `AssertionError: expected FORBIDDEN`.
- `rebuildWorkerImage on a dockerfile-sourced project re-enqueues a build (force)` — unit — project is dockerfile-sourced + verified → sets `worker_image_build_status='building'` and calls `enqueueWorkerImageBuildJob` even though the content hash is unchanged (so a refreshed base is picked up). Expected red: `AssertionError: expected enqueue on rebuild`.
- `rebuildWorkerImage on a non-dockerfile project is a BAD_REQUEST` — unit — default/reference project → `BAD_REQUEST` (nothing to rebuild). Expected red: `AssertionError: expected BAD_REQUEST`.

**Implementation** (`src/api/routers/projects.ts`):
- `rebuildWorkerImage: superadmin mutation({ projectId })` — require `workerImageSource === 'dockerfile'`; set `worker_image_build_status='building'`; emit an audit line; `enqueueWorkerImageBuildJob({projectId, buildHash: existing worker_image_build_hash})`. The engine recomputes the full hash against the current base, so a base bump actually rebuilds.

### 4. CLI — file/stdin input + clear + rebuild + show

**Tests first** (`tests/unit/cli/projects-worker-dockerfile.test.ts`):

- `--dockerfile-file <path> reads the file and passes workerDockerfile` — unit — point at a temp file with multi-line content → the mutate call receives the file's exact bytes. Expected red: `AssertionError: expected workerDockerfile to equal file content`.
- `--dockerfile-file - reads stdin` — unit — pipe content on stdin → passed through. Expected red: `AssertionError`.
- `--dockerfile-file is mutually exclusive with --worker-image` — unit — both flags → oclif exclusive error, no mutate call. Expected red: `AssertionError: expected an exclusivity error`.
- `--clear-dockerfile passes workerDockerfile: null` — unit — → `mutate({workerDockerfile:null})`. Expected red: `AssertionError`.
- `rebuild command calls rebuildWorkerImage` — unit — `projects update <id> --rebuild-worker-image` (or the sibling command) → `rebuildWorkerImage.mutate({projectId})`. Expected red: `AssertionError`.
- `show renders dockerfile presence + build status` — unit — a dockerfile-sourced project → output includes a Dockerfile-source indicator + `workerImageBuildStatus`. Expected red: `AssertionError: expected output to mention Dockerfile`.

**Implementation**:
- `src/cli/dashboard/projects/update.ts` (beside lines 42-49): add `--dockerfile-file <path>` (hand-rolled `readFileSync(path)` or `readFileSync(0)` for `-`, following the `params.ts:readFileInput` precedent — the operator CLI has no gadget helper), `exclusive: ['worker-image','clear-worker-image']`; `--clear-dockerfile`; a `--rebuild-worker-image` boolean routed to the `rebuildWorkerImage` mutation.
- `src/cli/dashboard/projects/create.ts` (beside 35-37): the same `--dockerfile-file` option.
- `src/cli/dashboard/projects/show.ts` (beside 11-25): render whether the project is Dockerfile-sourced + `workerImageBuildStatus` + `workerImageError`.

---

## Test Plan

### Unit tests
- [ ] `tests/unit/config/worker-dockerfile-content.test.ts`: ~4 (empty, oversize, reject-FROM, valid)
- [ ] `tests/unit/api/routers/projects-worker-dockerfile.test.ts`: ~11 (gate, reject, set+enqueue, mutual-exclusivity ×2, idempotent skip, clear, audit, rebuild ×3)
- [ ] `tests/unit/cli/projects-worker-dockerfile.test.ts`: ~6 (file, stdin, exclusivity, clear, rebuild, show)

### Integration tests
- [ ] Optional: an API-level integration that sets a Dockerfile and asserts the row + that a `worker-image-build` job was enqueued (Docker not required — enqueue is mocked/inspected).

### Acceptance tests
- [ ] Covered by per-plan AC #1–#6 below.

---

## Manual Verification (for `[manual]`-tagged ACs only)

n/a — all ACs auto-tested.

---

## Acceptance Criteria (per-plan, testable)

1. Only a superadmin can set/clear a project's Dockerfile or trigger a rebuild; other roles get `FORBIDDEN`; every change emits the grep-stable audit line (spec AC #10).
2. Content that declares its own `FROM`, is empty, or exceeds the cap is rejected `BAD_REQUEST` at set time and nothing is persisted (spec AC #4).
3. Setting a Dockerfile clears any referenced image and vice versa; a project always has exactly one effective image source (spec AC #3).
4. A valid set writes the content + content-hash + `building` build status and enqueues a superseding `worker-image-build` job; a byte-identical re-save on an already-verified project does **not** enqueue a rebuild; an explicit rebuild re-enqueues even when the content is unchanged (spec AC #6, #8).
5. The value round-trips through the CLI (including `--dockerfile-file <path>` and `-` stdin) and the API; `show` reflects Dockerfile-source + build status (spec AC #2, CLI/API half).
6. Builds are enqueued only via the superadmin-gated set/rebuild path; no project secrets are added to the enqueue payload (spec AC #11, gate half).
7. All new/modified code has corresponding tests.
8. `npm run build`, `npm test`, `npm run lint`, `npm run typecheck` pass.
9. Documentation Impact updated.

**Partial-state criterion:**
- The feature is fully operable via CLI + API; the dashboard control and operator docs land in plan 5.

---

## Documentation Impact (this plan only)

| File | Change |
|---|---|
| `CHANGELOG.md` | Under Unreleased: "`cascade projects` CLI + projects API can set/clear a per-project worker Dockerfile (extra layers on the standard image) and trigger a rebuild; mutually exclusive with a referenced image; superadmin-only + audited." |

---

## Out of Scope (this plan)

- Dashboard textarea/status/rebuild-button UI + operator walkthrough docs (plan 5).
- The build itself (plan 3) and the launch (plan 2).
- Build-time secrets, registry push, full arbitrary Dockerfiles, base-bump fan-out (spec Out of Scope).

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
- [ ] AC #9
