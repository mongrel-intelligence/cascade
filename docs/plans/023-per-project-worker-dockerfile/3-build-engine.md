---
id: 023
slug: per-project-worker-dockerfile
plan: 3
plan_slug: build-engine
level: plan
parent_spec: docs/specs/023-per-project-worker-dockerfile.md
depends_on: [2-spawn-resolution.md]
status: pending
---

# 023/3: Router-side build engine — compose, build, pin, smoke-test, content-hash, timeout, GC

> Part 3 of 5 in the 023-per-project-worker-dockerfile plan. See [parent spec](../../specs/023-per-project-worker-dockerfile.md).

## Summary

The high-risk core: the first-ever `docker.buildImage()` in the tree. This plan adds a router-side
**`worker-image-build`** job that composes the operator's extra layers onto the pinned CASCADE base, builds a
local image, pins it by its immutable local image ID, runs the **existing** worker-runtime smoke-test against
it, and records `verified`/`failed` **fail-closed** — a strict superset of spec 022's validation job, sharing
its DI shape, deterministic-per-project jobId, ref-guard, and never-leave-it-hanging discipline.

It rides the existing dashboard-jobs seam: the router already special-cases `worker-image-validation` in its
dashboard-job dispatcher and runs it **without** taking a worker slot (only the router holds the Docker
socket). The build job sits beside it on the same queue with the same remove-prior-then-add dedup, so a
re-enqueue **supersedes** an in-flight build for free.

Ships **operator-unreachable-but-tested**: no set surface enqueues a build yet (plan 4), so every behavior is
tested by invoking `handleWorkerImageBuild` directly with a payload against a fabricated `dockerfile`-sourced
project row, exactly as spec 022 tested its validation handler pre-set-surface.

The engine's contract, in order:

1. **Guard** — drop if the DB's `worker_image_build_hash` no longer equals the job's hash (superseded).
2. **Resolve base digest** — resolve the global `routerConfig.workerImage` to an immutable `@sha256` digest
   (the base the composed `FROM` pins to; also a component of the content-hash).
3. **Compose** — wrap the operator's content: `FROM <base>@<digest>` · `USER root` · `<operator lines>` ·
   `USER node` · `LABEL cascade.managed=true`. Defensively reject content that declares its own `FROM`.
4. **Content-hash reuse** — if a local built image already carries this exact build hash and is intact, reuse
   it (no rebuild) and go straight to pin+verify.
5. **Build** — `docker.buildImage()` from an in-memory tar containing only the composed Dockerfile, tagged
   `cascade-built-<projectId>:latest`, bounded by a wall-clock `WORKER_BUILD_TIMEOUT_MS`. Build failure →
   `failed` with reason `build failed: …`.
6. **Pin** — inspect the built image → immutable local image ID; this is the launchable pin (plan 2 launches
   it).
7. **Smoke-test** — run the shared `buildWorkerImageCheckScript` against the built image; non-zero →
   `failed` with reason `runtime requirement missing: …` (distinct from a build failure).
8. **Record fail-closed** — write the active pin + statuses, guarded on the build hash; on a rebuild that
   **fails while a last-good verified image exists**, keep `worker_image_status = verified` on the old pin
   (project keeps running) and record only `worker_image_build_status = failed` + the reason (spec AC #9).

**Components delivered:**
- `src/router/worker-image-build.ts` — `handleWorkerImageBuild` + injectable `WorkerImageBuildDeps`
- `src/router/worker-dockerfile-compose.ts` — pure compose + content-hash helpers
- `src/db/repositories/projectsRepository.ts` — `recordWorkerImageBuildResult(...)` (build-hash-guarded) + a small `readWorkerImageBuildInputs(projectId)`
- `src/queue/client.ts` — `worker-image-build` job type + `enqueueWorkerImageBuildJob` + deterministic jobId
- `src/router/worker-manager.ts` — dispatch branch for `worker-image-build` in `processDashboardJob`
- `src/router/config.ts` — `workerBuildTimeoutMs` (env `WORKER_BUILD_TIMEOUT_MS`, sensible default)
- Built images carry `LABEL cascade.managed=true` so `dangling-image-cleanup` reaps superseded digests

**Deferred to later plans in this spec:**
- The set surfaces that compute the hash + enqueue the build + reject-`FROM` at set time (plan 4)
- Dashboard states + rebuild button + docs (plan 5)

---

## Spec ACs satisfied by this plan

- Spec AC #5 (compose + build + validate fail-closed; distinguish build-failure from runtime-missing; pending/building/failed never launches) — **full**.
- Spec AC #6 (async build job; building → verified/failed; supersede; wall-clock timeout → failed, never wedged) — **partial** (this plan provides the job/states/supersede/timeout core; plans 4/5 surface them on CLI/API/dashboard).
- Spec AC #8 (content-hash rebuild/reuse) — **partial** (this plan provides the engine-side reuse-if-unchanged + rebuild-on-change; plan 4 provides the manual rebuild trigger, plan 5 the button).
- Spec AC #9 (GC + last-good pin; a failed rebuild or GC sweep never strands a project) — **full**.
- Spec AC #11 (build gated, bounded timeout, no secrets injected, master key absent from the build) — **partial** (this plan provides the *build* half; plan 2 provided the *launch-posture* half; plan 4 provides the superadmin gate on the set that enqueues it).

---

## Depends On

- Plan 2 (spawn-resolution) — spawn launches a verified built image by its local pin, so a build produced here is end-to-end launchable; and it defines the reachability guard the built image relies on.
- Plan 1 (schema) — the three columns, `building` status, and derived source.

---

## Detailed Task List (TDD)

### 1. Compose + content-hash helpers (pure)

**Tests first** (`tests/unit/router/worker-dockerfile-compose.test.ts`):

- `composeDockerfile wraps content with pinned FROM, root/node switch, and managed label` — unit — `composeDockerfile('RUN apt-get install -y jq', 'ghcr.io/x/cascade-worker@sha256:deadbeef')` → begins `FROM ghcr.io/x/cascade-worker@sha256:deadbeef`, contains `USER root`, the operator line, a trailing `USER node`, and `LABEL cascade.managed=true`. Expected red: `TypeError: composeDockerfile is not a function`.
- `composeDockerfile rejects content that declares its own FROM` — unit — content containing a `FROM ubuntu` line → throws a `WorkerDockerfileComposeError` with a clear message. Expected red: `AssertionError: expected function to throw`.
- `computeContentHash is stable over raw operator content` — unit — same content → identical hash; different content → different hash. This is the **column/job identity** (Docker-free, so the set surface in plan 4 can compute it). Expected red: `TypeError: computeContentHash is not a function`.
- `computeFullBuildHash folds in the base digest` — unit — same content + same base digest → identical; changing **either** content **or** base digest → different. This is the **image-label reuse key**. Expected red: `AssertionError: expected two different hashes` (proves the base digest is in the key, guarding the DevPod stale-base failure mode).

**Implementation** (`src/router/worker-dockerfile-compose.ts`):
- `composeDockerfile(content: string, baseDigestRef: string): string` — assemble the wrapped Dockerfile; throw `WorkerDockerfileComposeError` if `content` matches a `FROM`-line regex (case-insensitive, line-anchored).
- `computeContentHash(content: string): string` — `sha256` hex of the raw operator content. Stored in the `worker_image_build_hash` **column**, carried as the job payload `buildHash`, and used as the supersede guard + set-time change-detection key. Computed by the set surface (plan 4), which has no Docker access.
- `computeFullBuildHash(composed: string, baseDigestRef: string): string` — `sha256` hex of `composed + '\n' + baseDigestRef`. Stamped on the built image as `LABEL cascade.build_hash` and used by the engine for base-drift-aware reuse detection.

### 2. Build-result persistence (build-hash-guarded)

**Tests first** (`tests/unit/db/repositories/projectsRepository.test.ts` — extend; guard-shape unit + an integration round-trip in `tests/integration/db/projectsRepository.test.ts`):

- `recordWorkerImageBuildResult writes verified pin only when build hash matches` — integration — set `worker_image_build_hash='H'`, call with hash `'H'`, `{status:'verified', digest:'sha256:img', buildStatus:null}` → row updated; call with stale hash `'OLD'` → returns `false`, no write. Expected red: `AssertionError: expected write to be guarded by build hash`.
- `recordWorkerImageBuildResult on a failed rebuild keeps a prior verified image active` — integration — project already `worker_image_status='verified'` + `worker_image_digest='sha256:good'`; call with `{buildStatus:'failed', error:'build failed: x', keepActive:true}` → `worker_image_status` stays `verified`, `worker_image_digest` stays `sha256:good`, `worker_image_build_status='failed'`, `worker_image_error` set. Expected red: `AssertionError: expected 'verified' but got 'failed'` (no-strand pin).
- `recordWorkerImageBuildResult on a failed FIRST build sets status=failed` — integration — no prior verified image; `{buildStatus:'failed', keepActive:false}` → `worker_image_status='failed'`, no active pin. Expected red: `AssertionError`.

**Implementation** (`src/db/repositories/projectsRepository.ts`, mirroring `recordWorkerImageValidationResult:153`):
- `recordWorkerImageBuildResult(projectId, buildHash, result): Promise<boolean>` — UPDATE guarded by `WHERE id = projectId AND worker_image_build_hash = buildHash`. `result` carries the new active-image fields (`status`, `digest`, `error`), the `buildStatus`, and a `keepActive` flag; when `keepActive` is true it does **not** overwrite `worker_image_status`/`worker_image_digest` (leaves the last-good active).
- `readWorkerImageBuildInputs(projectId)` — returns `{ workerDockerfile, workerImageBuildHash, priorStatus, priorDigest }` for the handler.

### 3. Queue job type + enqueue + router dispatch

**Tests first** (`tests/unit/queue/worker-image-build-job.test.ts`):

- `enqueueWorkerImageBuildJob adds a worker-image-build job with a deterministic per-project id` — unit — call with `{projectId:'p1', buildHash:'H'}` → the queue receives a job of type `worker-image-build`, jobId `worker-image-build-p1`, and the prior same-id job is removed first. Expected red: `TypeError: enqueueWorkerImageBuildJob is not a function`.
- `DashboardJob union includes worker-image-build` — unit — a `{type:'worker-image-build', projectId, buildHash}` value type-checks / parses. Expected red: type/parse failure.

**Tests first** (`tests/unit/router/worker-manager.test.ts` — extend):

- `processDashboardJob dispatches worker-image-build to handleWorkerImageBuild without a worker slot` — unit — feed a `worker-image-build` job → `handleWorkerImageBuild` invoked, `guardedSpawn` **not** invoked. Expected red: `AssertionError: expected handleWorkerImageBuild to have been called`.

**Implementation**:
- `src/queue/client.ts` — add `WorkerImageBuildJob` to the `DashboardJob` union (beside `WorkerImageValidationJob:60`); add `enqueueWorkerImageBuildJob({projectId, buildHash})` + `workerImageBuildJobId(projectId)` mirroring `enqueueWorkerImageValidationJob:160` (remove prior, then add).
- `src/router/worker-manager.ts` — in `processDashboardJob` (~line 80), add a `case 'worker-image-build'` branch calling `handleWorkerImageBuild(job.data)` directly (no `guardedSpawn`), beside the existing `worker-image-validation` branch.

### 4. The build handler (compose → build → pin → smoke-test → record), fail-closed

**Tests first** (`tests/unit/router/worker-image-build.test.ts` — all with an injected `WorkerImageBuildDeps` mock; no real Docker):

- `superseded build (hash mismatch) is dropped without building` — unit — `readInputs` returns build hash `'NEW'`, job carries `'OLD'` → `buildImage` never called, `recordResult` not called with a verified write. Expected red: `AssertionError: expected buildImage not to have been called`.
- `happy path: compose → build → pin → smoke-test pass → verified` — unit — mocks succeed → `recordWorkerImageBuildResult` called with `{status:'verified', digest:<built image id>, buildStatus:null}`; the tag `cascade-built-<projectId>:latest` is used. Expected red: `AssertionError: expected recordResult status 'verified'`.
- `build failure → failed with 'build failed:' reason` — unit — `buildImage` rejects → `recordResult` with `buildStatus:'failed'`, reason starts `build failed:`; smoke-test never runs. Expected red: `AssertionError: expected reason to start with 'build failed:'`.
- `smoke-test non-zero → failed with 'runtime requirement missing:' reason` — unit — build succeeds, `runImageCheck` returns non-zero (`FAIL: git check failed`) → `recordResult` with `buildStatus:'failed'`, reason starts `runtime requirement missing:`. Expected red: `AssertionError: expected distinct runtime-missing reason` (guards AC5's build-vs-runtime distinction).
- `wall-clock timeout → failed, never left building` — unit — `buildImage` hangs past `workerBuildTimeoutMs` (fake timer) → resolves to `failed` (reason mentions timeout), and `recordResult` is called (never leaves `building`). Expected red: `AssertionError: expected a failed result within the timeout`.
- `failed rebuild with a prior verified image keeps it active` — unit — `readInputs.priorStatus==='verified'` + prior digest set, build fails → `recordResult` called with `keepActive:true`. Expected red: `AssertionError: expected keepActive true`.
- `content-hash reuse: intact image whose full-hash label matches the recomputed full hash skips docker build` — unit — `inspectBuiltImage` reports an existing `cascade-built-<projectId>:latest` whose `cascade.build_hash` label equals `computeFullBuildHash(composed, currentBaseDigest)` → `buildImage` not called; result `verified` reusing the existing pin. (A changed base digest yields a different full hash → no reuse → rebuild, satisfying "changing the base triggers a rebuild".) Expected red: `AssertionError: expected buildImage not called on reuse`.
- `any thrown error is caught, Sentry-captured, and recorded failed (never throws, never left building)` — unit — an unexpected throw in the middle → captured under a stable tag; `recordResult` failed. Expected red: `AssertionError: expected handler not to reject`.

**Implementation** (`src/router/worker-image-build.ts`):
- `WorkerImageBuildDeps` (mirroring `WorkerImageValidationDeps:51`): `resolveBaseDigest()`, `buildImage(composed, tag, timeoutMs)`, `inspectBuiltImage(tag)` (→ image ID + `cascade.build_hash` label), `runImageCheck(imageRef)` (reuse `buildWorkerImageCheckScript` + the same one-shot `docker.run` as validation), `readInputs`, `recordResult`, plus config `workerBuildTimeoutMs`.
- `handleWorkerImageBuild(payload, deps = defaultDeps)` — execute the 8-step contract above. **Fail-closed**: every non-verified path (compose error, build error, smoke-test non-zero, timeout, unexpected throw) routes through `recordResult` with `buildStatus:'failed'` + a precise reason and Sentry capture under tag `worker_image_build`; it never throws and never leaves the project `building`.
- `buildImage` default impl: create an in-memory tar `{ Dockerfile: composed }` (via the tar helper transitively available through dockerode), call `docker.buildImage(tar, { t: tag, dockerfile: 'Dockerfile' })`, drain the build stream, enforce `timeoutMs` via a race; the resulting image carries `LABEL cascade.managed=true` (from the composed Dockerfile) so it is reapable when superseded.

### 5. GC / last-good retention

**Tests first** (`tests/unit/router/worker-image-build.test.ts` — extend; and a `dangling-image-cleanup` assertion in `tests/unit/router/dangling-image-cleanup.test.ts`):

- `a successful rebuild retags :latest so the prior built image becomes dangling (reapable)` — unit — after a second verified build, the old image ID is no longer tagged; assert the tag now points at the new image ID (the old one is left for the existing dangling reaper, which already filters `cascade.managed=true`). Expected red: `AssertionError: expected :latest to point at the new image id`.
- `the active (tagged) built image is never dangling` — unit/assertion — confirm the active `cascade-built-<projectId>:latest` is tagged and therefore excluded by the `dangling=true` filter (last-good is structurally exempt from GC). Expected red: n/a if regression; pins the exemption.

**Implementation**:
- Built images are tagged `cascade-built-<projectId>:latest` and carry `LABEL cascade.managed=true`. On a successful rebuild the tag is moved to the new image, so the superseded digest becomes dangling and is reclaimed by the existing 30-minute `dangling-image-cleanup` loop — **no new GC loop**. The active tagged image is never dangling, so a GC sweep can never remove the last-good image (spec AC #9). A **failed** rebuild does not retag, so the active image is untouched.

---

## Test Plan

### Unit tests
- [ ] `tests/unit/router/worker-dockerfile-compose.test.ts`: ~3 (compose shape, reject-FROM, content-hash folds base digest)
- [ ] `tests/unit/queue/worker-image-build-job.test.ts`: ~2 (enqueue + deterministic id, union)
- [ ] `tests/unit/router/worker-manager.test.ts`: +1 (dispatch branch, no slot)
- [ ] `tests/unit/router/worker-image-build.test.ts`: ~9 (supersede, happy path, build-fail, smoke-fail, timeout, keep-active, reuse, catch-all, retag/GC)
- [ ] `tests/unit/router/dangling-image-cleanup.test.ts`: +1 (active tagged image not dangling)

### Integration tests
- [ ] `tests/integration/db/projectsRepository.test.ts`: ~3 (`recordWorkerImageBuildResult` guard + keep-active + first-build-failed)

### Acceptance tests
- [ ] Covered by per-plan AC #1–#7 below. (End-to-end build→spawn against a real Docker daemon is exercised opportunistically where a socket is available; the handler is fully unit-tested with injected deps regardless.)

---

## Manual Verification (for `[manual]`-tagged ACs only)

n/a — all ACs auto-tested (Docker interactions are behind the injectable `WorkerImageBuildDeps`; the real-daemon path is covered by the shared runtime smoke-test the handler reuses).

---

## Acceptance Criteria (per-plan, testable)

1. `handleWorkerImageBuild` composes the operator's content onto the pinned base (`FROM <base>@digest` + root/node switch + `cascade.managed` label), builds a local image, pins its immutable local image ID, and runs the shared runtime smoke-test against it.
2. A build failure records `failed` with a `build failed:` reason; a smoke-test failure records `failed` with a distinct `runtime requirement missing:` reason; neither is ever launchable (fail-closed).
3. The build runs as a router-side `worker-image-build` dashboard job (no worker slot) with a deterministic per-project jobId; a re-enqueue supersedes an in-flight build, and a stale build's result is dropped by the build-hash guard.
4. A build that exceeds `workerBuildTimeoutMs` resolves to `failed` (never left `building`); any unexpected error is caught, Sentry-captured, and recorded `failed`.
5. An unchanged Dockerfile+base (matching build hash on an intact image) reuses the built image without invoking `docker build`.
6. A rebuild of a project that already has a verified image keeps `worker_image_status = verified` on the last-good pin while it runs and even if it fails (`worker_image_build_status` carries building/failed) — the project never loses its runnable image; a superseded built image becomes dangling and is reclaimed by the existing reaper, while the active tagged image is never reaped.
7. Built-image builds inject **no** project secrets and the credential master key is never available to the build.
8. All new/modified code has corresponding tests.
9. `npm run build`, `npm test`, `npm run lint`, `npm run typecheck` pass.
10. Documentation Impact updated.

**Partial-state criterion:**
- The build engine is fully functional and unit-tested, but no operator surface enqueues a build yet — it is exercised only by direct `handleWorkerImageBuild` invocation until plan 4.

---

## Documentation Impact (this plan only)

| File | Change |
|---|---|
| `CHANGELOG.md` | Under Unreleased: "Router builds a per-project worker image from Dockerfile content (compose-onto-base, local pin, runtime smoke-test, content-hash reuse, wall-clock timeout, fail-closed) as a superseding dashboard job; superseded images are GC'd via the existing dangling-image reaper." |

---

## Out of Scope (this plan)

- Computing the hash + enqueuing the build from a set mutation, reject-`FROM` at set time, mutual-exclusivity, audit, manual-rebuild trigger (plan 4).
- Dashboard building/failed rendering + rebuild button + operator docs (plan 5).
- Build-time secrets / private packages (spec Out of Scope — the handler injects none; the credential seam is untouched here).
- BuildKit `--secret`/`--ssh`, rootless BuildKit, registry push (spec Out of Scope).
- Auto fan-out rebuild on base-image republish (spec Out of Scope).

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
- [ ] AC #10
