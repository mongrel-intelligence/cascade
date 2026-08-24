---
id: 022
slug: per-project-worker-image
plan: 3
plan_slug: set-validation
level: plan
parent_spec: docs/specs/022-per-project-worker-image.md
depends_on: [2-spawn-resolution.md]
status: pending
---

# 022/3: Set image (CLI/API, superadmin), router-side validation job, audit

> Part 3 of 4 in the 022-per-project-worker-image plan. See [parent spec](../../specs/022-per-project-worker-image.md).

## Summary

The operator-facing backend: let a superadmin set/clear a project's worker image via the tRPC API and the
CLI, validate it **fail-closed** with a Docker-capable router-side job, and pin its immutable digest. Because
only the router holds the Docker socket, the set mutation does not validate inline — it records the reference
as `pending` and enqueues a validation job on the existing dashboard-jobs queue. The router-side handler pulls
the image, resolves its digest via `inspect`, and runs the extended runtime smoke-test; on success it marks
the project `verified` (digest pinned), on failure `failed` with a precise reason.

After this plan, the feature is fully functional headless: an operator runs
`cascade projects update <id> --worker-image <ref>`, the image is verified within seconds, and (because plan 2
already wired spawn) subsequent jobs run on the pinned digest. Setting is restricted to superadmin and every
change emits a structured audit log line. The dashboard control is the only piece left (plan 4).

**Components delivered:**
- `src/api/routers/projects.ts` — `update`/`create` accept `workerImage`; superadmin-gated; syntactic ref
  validation; persist `pending` + enqueue validation; clearing reverts to global. `defaults` exposes the
  global image. A structured audit log on every change.
- `src/queue/client.ts` (+ job type module) — a `worker-image-validation` job + enqueue helper.
- `src/router/worker-image-validation.ts` (new) — the router-side handler: pull → `inspect` digest →
  extended smoke-test → write `verified` (digest) or `failed` (reason).
- `tests/docker/worker-runtime-tools/run-test.sh` (extended) — assert `cascade-tools --version`, `node`,
  `git`, the engine CLI(s) in addition to the existing python/Playwright checks; reused by the validator.
- `src/cli/dashboard/projects/` — `--worker-image` on `update`/`create`; `show` renders status; an explicit
  clear flag.

**Deferred to later plans in this spec:**
- Dashboard UI for set/clear + status display (plan 4).

---

## Spec ACs satisfied by this plan

- Spec AC #2 (set/clear round-trips through CLI + API + dashboard) — **partial** (CLI + API here; dashboard plan 4).
- Spec AC #3 (resolve + pin the immutable digest) — **partial** (this plan resolves + pins; launch-uses-digest is plan 2).
- Spec AC #4 (fail-closed validation: malformed ref rejected; pending/failed never launches; precise reason) — **full**.
- Spec AC #8 (only superadmin may set/change; recorded for audit) — **full**.

---

## Depends On

- Plan 2 (spawn-resolution) — spawn already honors a verified digest, so a verified image is immediately live.
- Plan 1 (schema) — the four `worker_image*` fields.

---

## Detailed Task List (TDD)

### 1. Extended runtime smoke-test (the validation contract)

**Tests first** (`tests/unit/docker/worker-runtime-tools-contract.test.ts`):
- `the smoke-test script asserts cascade-tools, node, git, and an engine CLI` — unit — parse/exercise the
  script's check list (or a thin wrapper that lists required checks) and assert it covers the hard contract.
  Expected red: `expected checks to include 'cascade-tools --version'` (current script only covers python/Playwright).

**Implementation** (`tests/docker/worker-runtime-tools/run-test.sh` + a small shared check-list module):
- Add assertions for `cascade-tools --version`, `node --version`, `git --version`, and engine-CLI presence
  (`command -v claude` / `codex` / `opencode` as applicable). Keep the existing python-shim + Playwright checks.
- Factor the required-check list so the validator (task 3) runs the same checks inside a candidate image.

### 2. tRPC set/clear mutation — superadmin, syntactic validation, enqueue, audit (AC2/AC4/AC8)

**Tests first** (`tests/unit/api/routers/projects-worker-image.test.ts`):
- `update with workerImage requires superadmin` — unit — non-superadmin actor → `TRPCError FORBIDDEN`; superadmin succeeds. Expected red: `expected FORBIDDEN, got OK` (no gate).
- `setting a syntactically-invalid ref is rejected synchronously` — unit — `workerImage: 'Not A Ref!!'` → `TRPCError BAD_REQUEST` naming the malformed ref; nothing persisted. Expected red: `expected BAD_REQUEST, got OK`.
- `setting a valid ref persists pending + enqueues a validation job` — unit (mock the enqueue) — row becomes `workerImage=<ref>`, `workerImageStatus='pending'`, digest/error cleared; the validation enqueue is called with `{projectId, ref}`. Expected red: `expected status 'pending' + enqueue called` — fails (mutation doesn't write status or enqueue).
- `clearing the worker image reverts to the global default` — unit — `workerImage: null` → all four fields cleared; no job enqueued. Expected red: `expected fields cleared, got <unchanged>`.
- `every set/clear emits a structured audit log line with actor + project + old→new` — unit (spy logger) — Expected red: `expected audit log call, got none`.

**Implementation** (`src/api/routers/projects.ts`):
- Add `workerImage` to `create`/`update` input. Gate worker-image changes behind the superadmin check (reuse
  the existing superadmin authorization used elsewhere in the API).
- Validate the ref string shape synchronously (image-reference grammar); reject malformed refs with `BAD_REQUEST`.
- On a valid ref: write `workerImage`, set `workerImageStatus='pending'`, clear `workerImageDigest`/`workerImageError`,
  enqueue the validation job. On clear: null all four.
- Emit a structured, grep-stable audit log (`{ event:'project_worker_image_changed', actorId, projectId, from, to }`).
- `defaults` query returns `routerConfig.workerImage` (the global) so the UI can show it as a placeholder.

### 3. Validation job + router-side handler (AC3/AC4)

**Tests first** (`tests/unit/router/worker-image-validation.test.ts`, `tests/unit/queue/worker-image-validation-job.test.ts`):
- `enqueue helper schedules a worker-image-validation job with the payload` — unit — Expected red: `expected job 'worker-image-validation' enqueued`.
- `handler resolves the digest and marks the project verified on a passing image` — unit (mock Docker: pull ok, inspect returns `RepoDigests:['repo@sha256:abc']`, smoke-test exits 0) → project updated `status='verified'`, `digest='sha256:abc'`, `error=null`. Expected red: `expected status 'verified', got <unchanged>`.
- `handler marks the project failed with a precise reason when the smoke-test fails` — unit (mock Docker: smoke-test exits non-zero, stderr names the missing binary) → `status='failed'`, `error` contains the missing requirement; digest unset. Expected red: `expected status 'failed' + error naming 'cascade-tools'`.
- `handler marks failed when the image is unpullable` — unit (mock Docker: pull rejects) → `status='failed'`, `error` names the pull failure. Expected red: `expected status 'failed', got throw/unchanged`.
- `handler is idempotent / re-validates on a newer ref` — unit — a second job for a changed ref overwrites the prior result. Expected red: `expected re-validation to update status`.

**Implementation** (`src/router/worker-image-validation.ts`, `src/queue/client.ts` + job-type wiring):
- Define the `worker-image-validation` job (payload `{ projectId, ref }`) on the dashboard-jobs queue + an
  enqueue helper.
- Handler (runs where the router consumes dashboard-jobs, i.e. with Docker): `pullImageOnce(ref)` (reuse the
  worker-snapshots pull path) → `inspect` to read the immutable digest → run the extended smoke-test inside a
  one-shot container (`docker run --rm`) → on success persist `digest` + `status='verified'`; on any failure
  persist `status='failed'` + a precise `error`. Never leave a project stuck in `pending` on handler error
  (catch → `failed` with the error string).

### 4. CLI surface (AC2)

**Tests first** (`tests/unit/cli/projects-worker-image.test.ts`):
- `projects update --worker-image <ref> calls the update mutation` — unit — Expected red: `command flag not recognized`.
- `projects update --clear-worker-image clears it` — unit — Expected red: `flag not recognized`.
- `projects show renders the worker image + status (pending/verified/failed reason)` — unit — Expected red: `expected output to include 'pending'`.
- `non-superadmin CLI invocation surfaces the FORBIDDEN message cleanly` — unit — Expected red: `expected friendly error, got raw stack`.

**Implementation** (`src/cli/dashboard/projects/`):
- Add `--worker-image <ref>` + a clear flag to `update` (and `create`); render status in `show`; surface the
  typed FORBIDDEN/BAD_REQUEST envelopes cleanly.

---

## Test Plan

### Unit tests
- [ ] `worker-runtime-tools-contract.test.ts`: ~1 — extended check list.
- [ ] `projects-worker-image.test.ts` (API): ~5 — authz, syntactic reject, pending+enqueue, clear, audit.
- [ ] `worker-image-validation.test.ts` (handler): ~5 — verified, failed-smoke, failed-pull, idempotent.
- [ ] `worker-image-validation-job.test.ts` (queue): ~1 — enqueue.
- [ ] `projects-worker-image.test.ts` (CLI): ~4 — flags + show + error rendering.

### Integration tests
- [ ] set → validation-job → verified round-trip against the test DB (mock Docker at the client boundary):
      mutation writes `pending`, handler writes `verified` + digest, re-read confirms.

### Acceptance tests
- [ ] Per-plan ACs below.

---

## Manual Verification (for `[manual]`-tagged ACs only)

*n/a — all ACs auto-tested (Docker client mocked at the boundary; the real-image smoke-test is exercised by
the deploy pipeline).*

---

## Acceptance Criteria (per-plan, testable)

1. A superadmin can set a project's worker image via `cascade projects update --worker-image <ref>` and the
   tRPC `projects.update`; a non-superadmin is refused (`FORBIDDEN`). *(AC8 authz)*
2. A syntactically-invalid reference is rejected synchronously (`BAD_REQUEST`, nothing persisted); a valid
   reference is stored `pending` and a validation job is enqueued. *(AC4 partial)*
3. The validation handler pulls the image, pins its immutable digest, and marks the project `verified` on a
   passing runtime smoke-test (cascade-tools + node + git + engine CLI + python/Playwright). *(AC3 + AC4)*
4. A failing image (missing toolchain or unpullable) is marked `failed` with a precise, operator-visible
   reason and is never used to launch a job; a project never stays stuck in `pending` on handler error. *(AC4 fail-closed)*
5. Clearing a project's worker image reverts it to the global default (all four fields null). *(AC2 partial)*
6. Every set/clear emits a structured, grep-stable audit log line (actor + project + old→new). *(AC8 audit)*
7. All new/modified code has tests; `npm run build`, `npm test`, `npm run test:integration`, `npm run lint`,
   `npm run typecheck` pass.
8. Documentation listed below is updated.

---

## Documentation Impact (this plan only)

| File | Change |
|---|---|
| `README.md` | Add a "per-project worker image" subsection: the `FROM cascade-worker:<pinned>` contract, `cascade projects update --worker-image <ref>`, the verify/pending/failed lifecycle, superadmin-only + audited. |
| `CHANGELOG.md` | Entry: "Configure a per-project worker image (CLI + API): superadmin-set, digest-pinned, validated fail-closed by a router-side smoke-test." |

---

## Out of Scope (this plan)

- Dashboard UI (plan 4).
- Building images from a Dockerfile, declarative extras, per-agent images, per-project registry credentials
  (spec Out of Scope; v1 assumes a host-pullable/public/local image).

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
