---
id: 023
slug: per-project-worker-dockerfile
plan: 2
plan_slug: spawn-resolution
level: plan
parent_spec: docs/specs/023-per-project-worker-dockerfile.md
depends_on: [1-schema.md]
status: pending
---

# 023/2: Spawn resolution — launch a built image by local pin, single-daemon guard, snapshot coexistence

> Part 2 of 5 in the 023-per-project-worker-dockerfile plan. See [parent spec](../../specs/023-per-project-worker-dockerfile.md).

## Summary

The runtime **launch** side. Make the worker-spawn path honor a project's **verified Dockerfile-built** image
and launch it **by its immutable local image ID** (stored in `worker_image_digest`), the way warm-cache
snapshots are already launched — not by a registry digest. Spec 022 only ever launched a registry
`repo@sha256`; this plan relaxes that for the `dockerfile` source and adds the single-daemon reachability guard
that a local-only image requires.

Ships **dormant-but-tested**: after this plan, spawn *would* correctly launch a verified built image, but no
build engine produces one yet (plan 3) and no operator can set one yet (plan 4). Every behavior here is
unit-tested against a **fabricated** `dockerfile`-sourced project config (status + local pin set directly),
mirroring how spec 022 tested spawn resolution before its set surface existed.

Three behavioral changes, all keyed on the derived `workerImageSource` from plan 1:

1. **Resolve + launch by local pin.** For `source === 'dockerfile'`, the effective base image is the verified
   `workerImageDigest` (a local image ID). A non-`verified` status or empty pin throws the existing terminal
   `WorkerImageResolutionError` (fail-closed — never silent fallback to the global default), exactly as the
   `reference` source does today. The `default` and `reference` sources are byte-for-byte unchanged.
2. **Single-daemon reachability guard.** A locally-built image is reachable only on the daemon that built it.
   The launch/retry path must **not** attempt a registry pull for a build-sourced base (a pull can never
   satisfy a purely-local image), and a missing build-sourced image must fail **loudly** with a grep-stable
   error rather than silently pulling, silently falling back, or hanging.
3. **Snapshot coexistence.** A `dockerfile`-sourced project that also uses warm-cache snapshots must classify
   snapshot reuse against its **built** base (not the global default), and a snapshot-image 404 must relaunch
   on the built base (local, no pull) — reusing the existing `effectiveBaseImage`-relative logic spec 022
   already fixed for the `reference` source.

**Components delivered:**
- `src/router/worker-spawn-settings.ts` — `resolveEffectiveBaseImage` / `resolveSpawnSettings` extended for the `dockerfile` source; new `effectiveBaseImageLocalOnly` flag + `workerImageSource` on the spawn settings; spawn log records source + effective image
- `src/router/container-manager.ts` — `launchOrPullAndRetry` reachability guard for a local-only base; snapshot-404 relaunch verified for a local base
- `src/router/types` (or the local `SpawnSettings` type) — the `effectiveBaseImageLocalOnly` + `workerImageSource` fields

**Deferred to later plans in this spec:**
- Producing a verified built image (plan 3)
- Operator set surfaces (plan 4), dashboard + docs (plan 5)

---

## Spec ACs satisfied by this plan

- Spec AC #1 (unconfigured **and** referenced projects spawn exactly as today) — **full** (this plan proves default + reference resolution is unchanged).
- Spec AC #7 (spawn launches the built image; log shows which image governed the run + that it came from the Dockerfile) — **full**.
- Spec AC #11 (launch posture unchanged — no new mounts/privileges) — **partial** (this plan covers the *launch* half; plan 3 covers the *build* half — gated/timeout/no-secrets).
- Spec AC #12 (single-daemon reachability guard — fail loud, never silent fallback) — **full**.

---

## Depends On

- Plan 1 (schema) — provides `workerDockerfile`, `workerImageBuildHash`, the `building` status value, and the derived `workerImageSource` on `ProjectConfig` that this plan branches on.

---

## Detailed Task List (TDD)

### 1. Effective-image resolution for the `dockerfile` source

**Tests first** (`tests/unit/router/worker-spawn-settings-dockerfile.test.ts`):

- `resolveEffectiveBaseImage returns the local pin for a verified dockerfile source` — unit — config `{ workerImageSource: 'dockerfile', workerImageStatus: 'verified', workerImageDigest: 'sha256:abc' }` → returns `'sha256:abc'` and marks the result local-only. Expected red: `AssertionError: expected <global default> to equal 'sha256:abc'`.
- `resolveEffectiveBaseImage throws terminal error for a building/pending dockerfile source` — unit — same config with `workerImageStatus: 'building'` (and `'pending'`) → throws `WorkerImageResolutionError`, never returns the global default. Expected red: `AssertionError: expected function to throw WorkerImageResolutionError`.
- `resolveEffectiveBaseImage throws for a failed or empty-pin dockerfile source` — unit — `status: 'failed'` OR `status: 'verified'` with empty `workerImageDigest` → throws. Expected red: `AssertionError: expected function to throw`.
- `resolveEffectiveBaseImage is unchanged for default and reference sources` — unit — `source: 'default'` → global default, not local-only; `source: 'reference'` verified → registry digest, not local-only. Expected red: `AssertionError: expected 'sha256:abc' to be marked local-only=false` (guards against over-broad local-only tagging).

**Implementation** (`src/router/worker-spawn-settings.ts`, at `resolveEffectiveBaseImage` ~line 79):
- Branch on `projectCfg.workerImageSource`:
  - `'default'` (or undefined) → `{ image: routerConfig.workerImage, localOnly: false }` (unchanged).
  - `'reference'` → existing verified-digest logic → `{ image: workerImageDigest, localOnly: false }` (unchanged).
  - `'dockerfile'` → require `workerImageStatus === 'verified' && workerImageDigest` truthy, else throw `WorkerImageResolutionError` naming the project + status; on success → `{ image: workerImageDigest, localOnly: true }`.
- Return shape carries `localOnly` so the caller can thread it into `SpawnSettings.effectiveBaseImageLocalOnly`.

### 2. Spawn settings — thread source + local-only + logging

**Tests first** (append to `worker-spawn-settings-dockerfile.test.ts`):

- `resolveSpawnSettings sets effectiveBaseImageLocalOnly and workerImageSource for a dockerfile source` — unit — verified dockerfile config → `settings.effectiveBaseImageLocalOnly === true && settings.workerImageSource === 'dockerfile'`. Expected red: `AssertionError: expected undefined to equal true`.
- `resolveSpawnSettings launch posture is unchanged for a dockerfile source` — unit — assert the produced `HostConfig`-relevant fields (memory, network, autoRemove) match the reference/default path; no new mount/privilege fields appear. Expected red: `AssertionError` if a mount/privileged field is introduced.
- `spawn log line includes workerImageSource and the effective image` — unit — capture the "Resolved spawn settings" log for a dockerfile source → contains `workerImageSource: 'dockerfile'` and the local pin. Expected red: `AssertionError: log entry missing workerImageSource`.

**Implementation** (`src/router/worker-spawn-settings.ts`, `resolveSpawnSettings` ~line 96 + the settings type):
- Add `effectiveBaseImageLocalOnly: boolean` and `workerImageSource: 'default' | 'reference' | 'dockerfile'` to the spawn-settings result; populate from step 1.
- Extend the existing `[WorkerManager] Resolved spawn settings` log to include `workerImageSource` and the resolved `effectiveBaseImage` (AC7). Do **not** change the launch `HostConfig` construction.

### 3. Single-daemon reachability guard in the launch path

**Tests first** (`tests/unit/router/container-manager-dockerfile.test.ts`):

- `launchOrPullAndRetry does NOT attempt a pull for a local-only base` — unit — inject a docker mock whose `run` throws image-not-found once; with `effectiveBaseImageLocalOnly: true`, assert `pull` is **never** called. Expected red: `AssertionError: expected pull to not have been called` (current code pulls a custom base).
- `launchOrPullAndRetry throws a grep-stable terminal reachability error for a missing local-only base` — unit — image-not-found + `localOnly: true` → throws `WorkerImageResolutionError` whose message contains a stable marker (e.g. `built worker image not present on this router daemon`). Expected red: `AssertionError: expected WorkerImageResolutionError with 'not present on this router daemon'`.
- `launchOrPullAndRetry is unchanged for a non-local reference base (still pulls on missing)` — unit — image-not-found + `localOnly: false` (custom reference base) → attempts a pull, retries. Expected red: none if regression; this pins the existing behavior so the guard doesn't over-fire.

**Implementation** (`src/router/container-manager.ts`, `launchOrPullAndRetry` ~lines 134-189):
- Thread `effectiveBaseImageLocalOnly` into this function. When an image-not-found occurs on the effective base **and** `localOnly` is true: skip the pull entirely and throw a terminal `WorkerImageResolutionError` with a grep-stable message naming the project and stating the Dockerfile-sourced-image single-daemon constraint (AC12).
- Leave the existing custom-reference base pull-and-retry (line ~157-161) intact for `localOnly: false`.

### 4. Snapshot coexistence with a built base

**Tests first** (append to `container-manager-dockerfile.test.ts`):

- `snapshot reuse is classified against the built base, not the global default` — unit — dockerfile-source verified, snapshot present → `snapshotReuse === true`; dockerfile-source verified, **no** snapshot (workerImage === built base) → `snapshotReuse === false`. Expected red: `AssertionError: expected false` (would fail if reuse were compared to the global default).
- `snapshot 404 relaunches on the built base without a pull` — unit — snapshot image-not-found for a dockerfile-source → invalidates snapshot and relaunches on the built base; assert no pull attempted (base is local). Expected red: `AssertionError: expected relaunch image to equal 'sha256:abc'` / pull unexpectedly called.

**Implementation** (`src/router/container-manager.ts`, snapshot classification ~line 253 + snapshot-404 relaunch ~line 295):
- Confirm/adjust so the `snapshotReuse` comparison and the 404 relaunch both use `effectiveBaseImage` (already the spec-022 fix) and honor `effectiveBaseImageLocalOnly` (relaunch on a local base must not pull). Mostly a coverage-adding + guard-threading change; no new comparison basis.

---

## Test Plan

### Unit tests
- [ ] `tests/unit/router/worker-spawn-settings-dockerfile.test.ts`: ~7 tests (resolution matrix, local-only flag, source+log, posture-unchanged)
- [ ] `tests/unit/router/container-manager-dockerfile.test.ts`: ~5 tests (no-pull guard, terminal reachability error, reference-base unchanged, snapshot reuse classification, snapshot-404 relaunch)

### Integration tests
- [ ] n/a — spawn resolution is pure/unit-testable with injected docker + fabricated config. (End-to-end build→spawn lands in plan 3/4.)

### Acceptance tests
- [ ] Covered by per-plan AC #1–#5 below.

---

## Manual Verification (for `[manual]`-tagged ACs only)

n/a — all ACs auto-tested.

---

## Acceptance Criteria (per-plan, testable)

1. For a fabricated `dockerfile`-sourced config that is `verified` with a non-empty local pin, spawn resolves and launches that local image ID; a `pending`/`building`/`failed`/empty-pin config throws the terminal `WorkerImageResolutionError` (fail-closed, never the global default).
2. `default` and `reference` source resolution is byte-for-byte unchanged (regression pin for spec AC #1).
3. A missing local-only (Dockerfile-sourced) image at launch throws a grep-stable terminal reachability error and **never** triggers a registry pull or a silent fallback to the global default (spec AC #12).
4. The spawn log records `workerImageSource` and the effective image; a `dockerfile`-sourced worker launches with the same `HostConfig` posture as today (no new mounts/privileges).
5. Snapshot reuse for a `dockerfile`-sourced project is classified against the built base, and a snapshot 404 relaunches on the built base without a pull.
6. All new/modified code has corresponding tests.
7. `npm run build`, `npm test`, `npm run lint`, `npm run typecheck` pass.
8. Documentation Impact updated.

**Partial-state criterion:**
- Spawn *would* launch a verified built image, but nothing produces or sets one yet — behavior is proven only via fabricated configs in unit tests.

---

## Documentation Impact (this plan only)

| File | Change |
|---|---|
| `CHANGELOG.md` | Under Unreleased: "Worker spawn can launch a verified Dockerfile-built image by local image ID, with a single-daemon reachability guard (fails loudly if the built image is absent on the serving router daemon)." |

---

## Out of Scope (this plan)

- Building / composing / pinning / validating the image (plan 3).
- Set surfaces, mutual-exclusivity enforcement, reject-`FROM`, audit, enqueue, manual rebuild (plan 4).
- Dashboard UI + operator docs (plan 5).
- Registry push / cross-daemon reachability (spec Out of Scope) — this plan *enforces* the single-daemon constraint rather than lifting it.

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
