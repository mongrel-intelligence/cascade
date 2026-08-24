---
id: 022
slug: per-project-worker-image
plan: 2
plan_slug: spawn-resolution
level: plan
parent_spec: docs/specs/022-per-project-worker-image.md
depends_on: [1-schema.md]
status: pending
---

# 022/2: Spawn resolution, effectiveBaseImage correctness fix, failure semantics

> Part 2 of 4 in the 022-per-project-worker-image plan. See [parent spec](../../specs/022-per-project-worker-image.md).

## Summary

The high-risk core: make the worker-spawn path honor a project's **verified** worker image, and fix the
latent correctness trap that a per-project base image exposes. Today three sites in `container-manager.ts`
use "image === the global `routerConfig.workerImage`" as the test for *"is this the base image?"* — driving
pull-fallback, snapshot-reuse classification, and snapshot-404 fallback. A per-project base breaks all three.
This plan introduces an explicit `effectiveBaseImage` (the project's base, or the global default) carried by
spawn settings, rewrites the three sites to compare against it, then resolves a verified per-project digest
into it.

After this plan, a project whose row carries a **verified** worker image + digest spawns workers from that
digest; an unconfigured project is byte-for-byte unchanged; a configured-but-unverified image fails loudly
rather than silently running on the global toolchain; and a missing-but-pullable custom image is pulled and
retried. The change is dormant for operators (no way to *set* an image yet — plan 3) and is exercised in
tests via directly-seeded `ProjectConfig`.

**Components delivered:**
- `src/router/worker-spawn-settings.ts` — `SpawnSettings` gains `effectiveBaseImage`; resolve a verified
  per-project digest; fail-loud on configured-but-unverified; extend the resolved-settings log.
- `src/router/container-manager.ts` — rewrite the three `routerConfig.workerImage` comparisons to use
  `effectiveBaseImage`; widen pull-fallback to a custom registry digest; fail-loud on unobtainable/invalid.
- `src/router/worker-snapshots.ts` (as needed) — snapshot commit/reuse keyed off `effectiveBaseImage`.

**Deferred to later plans in this spec:**
- The operator's ability to set + validate an image (plan 3) — until then the digest is seeded directly in tests.
- Dashboard UI (plan 4).

---

## Spec ACs satisfied by this plan

- Spec AC #1 (unconfigured project unchanged) — **full** (regression pin).
- Spec AC #3 (launches use the pinned digest) — **partial** (this plan launches from the stored digest;
  resolving/pinning the digest is plan 3).
- Spec AC #4 (fail-closed: pending/failed image never launches) — **partial** (this plan refuses to launch a
  non-verified configured image; producing the verified/failed state is plan 3).
- Spec AC #5 (spawn from configured image + log shows which image won) — **full**.
- Spec AC #6 (missing-pullable → pull+retry; unobtainable/invalid → fail loud, no silent base fallback) — **full**.
- Spec AC #7 (snapshot coexistence + correct reuse classification) — **full**.
- Spec AC #9 (launch posture unchanged: only Memory/Swap/Network + Labels, no mounts/privileged) — **full**.

---

## Depends On

- Plan 1 (schema) — `ProjectConfig.workerImage` / `workerImageDigest` / `workerImageStatus` fields.

---

## Detailed Task List (TDD)

### 1. Introduce `effectiveBaseImage` as a behavior-preserving refactor (AC1)

**Tests first** (`tests/unit/router/worker-spawn-settings.test.ts`, `tests/unit/router/container-manager.test.ts`):
- `resolveSpawnSettings returns effectiveBaseImage === routerConfig.workerImage when no per-project image` — unit — project with no worker-image fields → `effectiveBaseImage` equals the global default and `workerImage` is unchanged. Expected red: `expected property 'effectiveBaseImage' to be defined` (field doesn't exist).
- `pull-fallback fires for a missing base image classified via effectiveBaseImage` — unit (mock Docker) — image-not-found on the base → pull-once-and-retry still triggers, now keyed on `effectiveBaseImage`. Expected red: `effectiveBaseImage is not defined` / comparison still hard-codes the global.
- `snapshot-reuse + snapshot-404 fallback classify against effectiveBaseImage` — unit — with no per-project image, behavior identical to today. Expected red: `effectiveBaseImage is not defined`.

**Implementation** (`src/router/worker-spawn-settings.ts`, `src/router/container-manager.ts`):
- Add `effectiveBaseImage: string` to `SpawnSettings`; default it to `routerConfig.workerImage`.
- Replace the three `=== routerConfig.workerImage` comparisons in `container-manager.ts` (pull-fallback guard, `snapshotReuse`, snapshot-404 fallback) with `=== effectiveBaseImage` (passed through from spawn settings). With no per-project image this is a pure no-op refactor — the regression tests above must stay green.

### 2. Resolve a verified per-project digest (AC5) + fail-closed on unverified (AC4 partial)

**Tests first** (`tests/unit/router/worker-spawn-settings.test.ts`):
- `verified project image resolves workerImage + effectiveBaseImage to its digest` — unit — `ProjectConfig` with `workerImageStatus='verified'`, `workerImageDigest='sha256:abc'` → both `workerImage` and `effectiveBaseImage` are the digest. Expected red: `expected 'sha256:abc', got <global default>`.
- `pending/failed project image throws a clear terminal error (no silent global fallback)` — unit — `workerImage` set, `workerImageStatus='pending'` (no digest) → `resolveSpawnSettings` (or the spawn caller) raises a grep-stable error naming the project + status. Expected red: `expected throw, got <global default returned>`.
- `resolved-settings log records projectWorkerImage and globalWorkerImage` — unit — assert the `[WorkerManager] Resolved spawn settings` log payload includes both. Expected red: `expected log payload to contain projectWorkerImage`.

**Implementation** (`src/router/worker-spawn-settings.ts`):
- Before the snapshot block: if `projectCfg?.workerImage` is set, require `workerImageStatus === 'verified'` and a non-empty `workerImageDigest`; set `workerImage = effectiveBaseImage = workerImageDigest`. Otherwise (configured but not verified) raise a terminal, grep-stable error (e.g. `Project worker image not verified: <projectId> status=<status>`).
- Keep the snapshot substitution layered ON TOP of `effectiveBaseImage` (snapshots commit FROM the effective base — see task 4).
- Extend the resolved-settings log with `projectWorkerImage` (the project's configured ref/digest or null) and `globalWorkerImage` (`routerConfig.workerImage`).

### 3. Spawn-time pull + fail-loud semantics for a custom image (AC6)

**Tests first** (`tests/unit/router/container-manager.test.ts`):
- `missing-but-pullable custom digest is pulled and retried` — unit (mock Docker: first create 404s, pull succeeds, retry creates) — the launch pulls the custom digest and retries. Expected red: `expected pullImageOnce to be called with 'sha256:abc'` (current guard only pulls when image === global).
- `unpullable custom digest fails the job with a grep-stable terminal error` — unit (mock Docker: create 404, pull rejects) — throws an `UnrecoverableError`-class error naming the image; does NOT fall back to the global base. Expected red: `expected throw naming 'sha256:abc', got launch on global default`.

**Implementation** (`src/router/container-manager.ts`):
- Widen the pull-and-retry path so a missing **custom** registry image (now distinguishable because `effectiveBaseImage !== routerConfig.workerImage`) is pulled once and retried, reusing `pullImageOnce`.
- On pull failure or an otherwise unobtainable/invalid custom image, throw a terminal, grep-stable error — never silently relaunch on the global default toolchain.

### 4. Snapshot coexistence (AC7)

**Tests first** (`tests/unit/router/worker-snapshots.test.ts`, `tests/unit/router/container-manager.test.ts`):
- `snapshot for a custom-image project is committed FROM the effective base` — unit — with a verified custom digest, the snapshot base/commit source is the custom digest, not the global. Expected red: `expected snapshot base 'sha256:abc', got <global default>`.
- `a custom-image run without a snapshot is NOT misclassified as a snapshot reuse` — unit — `snapshotEnabled` true, no snapshot present, custom digest set → `snapshotReuse` is false and the run uses the custom base. Expected red: `expected snapshotReuse false, got true` (old code: `workerImage !== global` ⇒ treated as reuse).
- `snapshot-404 falls back to the effective base, not the global` — unit — snapshot image missing → fallback target is the custom digest. Expected red: `expected fallback 'sha256:abc', got <global default>`.

**Implementation** (`src/router/worker-snapshots.ts`, `src/router/container-manager.ts`):
- Thread `effectiveBaseImage` into snapshot commit + the `snapshotReuse` computation + the snapshot-404 fallback so all three reference the project's effective base.

### 5. Launch posture regression pin (AC9)

**Tests first** (`tests/unit/router/worker-container-launcher.test.ts`):
- `custom-image launch sets only Memory/Swap/Network + Labels, no Binds/Mounts/Privileged` — unit — assert the `createContainer` `HostConfig` for a custom digest has no `Binds`/`Mounts`/`Privileged` and the same shape as the base-image launch. Expected red: only meaningful as a guard; assert exact HostConfig keys — Expected red if a future change adds a mount.

**Implementation:** none beyond ensuring the custom-image path reuses the identical launch options (no new HostConfig fields). This is a regression pin.

---

## Test Plan

### Unit tests
- [ ] `worker-spawn-settings.test.ts`: ~8 — effectiveBaseImage default + verified resolution + fail-closed + log fields.
- [ ] `container-manager.test.ts`: ~12 — three-site reclassification + pull/fail-loud + snapshot interplay.
- [ ] `worker-snapshots.test.ts`: ~4 — commit-from-effective-base + reuse + 404 fallback.
- [ ] `worker-container-launcher.test.ts`: ~2 — posture pin.

### Integration tests
- [ ] n/a — Docker is mocked at the client boundary; real-container behavior is covered by the deploy smoke-test, not unit/integration here.

### Acceptance tests
- [ ] Per-plan ACs below (regression, resolution, fail-loud, snapshot, posture).

---

## Manual Verification (for `[manual]`-tagged ACs only)

*n/a — all ACs auto-tested (Docker client mocked at the boundary).*

---

## Acceptance Criteria (per-plan, testable)

1. With no per-project image, `resolveSpawnSettings` returns `effectiveBaseImage === routerConfig.workerImage`
   and the resolved image, snapshot behavior, and base-image pull-fallback are **identical to today**. *(AC1 regression)*
2. A project with `workerImageStatus='verified'` + a digest spawns from that digest; the resolved-settings log
   records both `projectWorkerImage` and `globalWorkerImage`. *(AC5)*
3. A configured-but-unverified (`pending`/`failed`) project image never launches — the spawn raises a clear,
   grep-stable terminal error instead of falling back to the global toolchain. *(AC4 partial)*
4. A missing-but-pullable custom digest is pulled and retried; an unpullable/invalid custom image fails the
   job with a grep-stable terminal error and is never silently replaced by the global default. *(AC6)*
5. Snapshots for a custom-image project commit FROM the effective base, snapshot-reuse is correctly classified
   (a no-snapshot custom run is not treated as a reuse), and snapshot-404 falls back to the effective base. *(AC7)*
6. A custom-image launch sets only resource/network limits + Labels — no bind mounts, no elevated
   privileges. *(AC9 security regression)*
7. All new/modified code has tests; `npm run build`, `npm test`, `npm run lint`, `npm run typecheck` pass.
8. Documentation listed below is updated.

---

## Documentation Impact (this plan only)

| File | Change |
|---|---|
| `CHANGELOG.md` | Entry (internal/behavioral): "Worker spawn resolves a verified per-project worker image and pins it; introduces `effectiveBaseImage` so per-project base images interplay correctly with snapshots + pull-fallback." |

---

## Out of Scope (this plan)

- Setting/validating an image; the validation job; CLI/API (plan 3) — until then digests are test-seeded.
- Dashboard UI (plan 4).
- Building images from a Dockerfile, declarative extras, per-agent images, per-project registry creds (spec Out of Scope).

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
