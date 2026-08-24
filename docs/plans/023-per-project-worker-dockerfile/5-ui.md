---
id: 023
slug: per-project-worker-dockerfile
plan: 5
plan_slug: ui
level: plan
parent_spec: docs/specs/023-per-project-worker-dockerfile.md
depends_on: [4-set-surfaces.md]
status: pending
---

# 023/5: Dashboard worker-Dockerfile control + operator walkthrough docs

> Part 5 of 5 in the 023-per-project-worker-dockerfile plan. See [parent spec](../../specs/023-per-project-worker-dockerfile.md).
>
> ⚠️ This plan touches `web/` and `docs/` only; follow the repo's normal push rules.

## Summary

The user-facing layer on top of the curl-testable backend. Extend the existing project-settings worker-image
control so a superadmin can choose the image **source** (global default / referenced image / Dockerfile), and,
for the Dockerfile source, paste the extra layers into a textarea, save, watch it build, read a failure reason,
and trigger a rebuild. The reference-image control from spec 022 stays exactly as-is; the two are presented as
mutually exclusive, matching the backend invariant.

The status display distinguishes the **active image** (`workerImageStatus`: pending / building / verified /
failed) from the **most recent build attempt** (`workerImageBuildStatus`: building / failed) so a project that
is still running its last-good image while a rebuild fails reads correctly — "Verified (last rebuild failed:
…)" rather than a misleading "Failed". The card polls while a build is in flight, reusing the existing poll
interval.

This plan also lands the operator documentation (spec AC #13, `[manual]`): the walkthrough for writing extra
layers, saving them, watching the build verify or fail, the mutual-exclusivity with a referenced image, the
rebuild action, and the single-daemon constraint.

**Components delivered:**
- `web/src/components/projects/project-worker-image.tsx` — source selector; `<Textarea>` for Dockerfile content; Set/Clear/Rebuild wired to `projects.update` / `projects.rebuildWorkerImage`; `WorkerImageStatusBadge` extended for `building` + `workerImageBuildStatus`; poll-while-building; superadmin gate + mutual-exclusivity UX
- `README.md`, `docs/getting-started.md`, `CHANGELOG.md` — operator docs

**Deferred to later plans in this spec:**
- None — this is the final plan.

---

## Spec ACs satisfied by this plan

- Spec AC #2 (set/clear round-trips through CLI + API + **dashboard**) — **partial** (this plan provides the dashboard half; plans 1/4 provide storage + CLI/API).
- Spec AC #6 (async build surfaced as building/verified/failed) — **partial** (this plan renders the states + poll; plan 3/4 produce them).
- Spec AC #8 (explicit rebuild) — **partial** (this plan provides the rebuild button; plan 4 the mutation, plan 3 the engine).
- Spec AC #13 (operator docs walkthrough) — **full** `[manual]`.

---

## Depends On

- Plan 4 (set-surfaces) — provides `projects.update({workerDockerfile})`, `projects.rebuildWorkerImage`, and the mutual-exclusivity + status semantics this UI renders.

---

## Detailed Task List (TDD)

### 1. Source selector + Dockerfile textarea

**Tests first** (`tests/unit/web/project-worker-dockerfile.test.ts`):

- `renders a Dockerfile textarea when the source is set to Dockerfile` — unit (render) — pick "Dockerfile" in the source selector → a `<textarea>` appears and the reference-image `<input>` is hidden (mutual exclusivity). Expected red: `TestingLibraryElementError: Unable to find a textarea`.
- `Set writes the textarea content via projects.update` — unit — type content + click Set → `trpcClient.projects.update.mutate` called with `{ id, workerDockerfile: <content> }`. Expected red: `AssertionError: expected update.mutate to have been called with workerDockerfile`.
- `Clear passes workerDockerfile: null` — unit — click Clear on a dockerfile-sourced project → `mutate({ id, workerDockerfile: null })`. Expected red: `AssertionError`.

**Implementation** (`web/src/components/projects/project-worker-image.tsx`):
- Add a source selector (default / reference / dockerfile) driven by the project's derived `workerImageSource`.
- For the dockerfile source, render the shared `web/src/components/ui/textarea.tsx` primitive (the `agent-prompt-overrides.tsx` multi-line precedent) + Set/Clear buttons calling `projects.update`. Selecting one source hides the other's control.

### 2. Build-status rendering + poll + rebuild

**Tests first** (append to `project-worker-dockerfile.test.ts`):

- `renders a building spinner while workerImageBuildStatus is building` — unit — project `workerImageBuildStatus:'building'` → a "Building…" indicator shows. Expected red: `AssertionError: expected a building indicator`.
- `renders a distinct last-rebuild-failed note while the active image stays verified` — unit — `workerImageStatus:'verified'` + `workerImageBuildStatus:'failed'` + `workerImageError:'…'` → shows "Verified" for the active image AND a "last rebuild failed: …" note (not a bare "Failed"). Expected red: `AssertionError: expected both verified and last-rebuild-failed text`.
- `renders a failed badge for a first-build failure` — unit — `workerImageStatus:'failed'` (no prior verified) → destructive "Validation failed: …". Expected red: `AssertionError`.
- `polls while a build is in flight` — unit — with `workerImageBuildStatus:'building'`, advance the timer by the poll interval → `projects.getById` re-fetched. Expected red: `AssertionError: expected a refetch`.
- `Rebuild button calls rebuildWorkerImage` — unit — click Rebuild on a dockerfile-sourced project → `projects.rebuildWorkerImage.mutate({ projectId })`. Expected red: `AssertionError`.
- `the whole control is hidden for a non-superadmin` — unit — non-superadmin role → renders null (reuse the existing gate). Expected red: `AssertionError: expected control to be hidden`.

**Implementation** (`web/src/components/projects/project-worker-image.tsx`):
- Extend `WorkerImageStatusBadge` to render `building` (spinner) and to combine `workerImageStatus` (active image) with `workerImageBuildStatus` (last build attempt) — showing "Verified · rebuild failed: …" when the active image is verified but the last rebuild failed.
- Poll `projects.getById` while `workerImageStatus === 'building' || workerImageBuildStatus === 'building'`, reusing the existing `WORKER_IMAGE_POLL_MS`.
- Add a Rebuild button (dockerfile source only) calling `projects.rebuildWorkerImage`. Keep the existing superadmin gate (`if (!isSuperadmin) return null`).

### 3. Operator documentation

**Implementation** (docs — verified via the manual protocol below):
- `README.md` (worker-image section, ~line 164): document the Dockerfile-source option — "supply only the extra layers; CASCADE supplies the pinned `FROM`" — its mutual exclusivity with a referenced image, and the single-daemon constraint.
- `docs/getting-started.md` (~lines 466-476, beside the existing `FROM cascade-worker` example): a walkthrough — write extra layers → save via dashboard/CLI/API → watch it build + verify (or read a failure) → trigger a rebuild to pick up a refreshed base.
- `CHANGELOG.md`: the user-visible dashboard control entry.

---

## Test Plan

### Unit tests
- [ ] `tests/unit/web/project-worker-dockerfile.test.ts`: ~9 (textarea render + mutual-exclusivity, set, clear, building spinner, last-rebuild-failed note, first-build-failed badge, poll, rebuild, superadmin gate)

### Integration tests
- [ ] n/a — component-level render tests cover the UI; the backend it calls is integration-tested in plans 1/3/4.

### Acceptance tests
- [ ] Covered by per-plan AC #1–#4 + the manual protocol below.

---

## Manual Verification (for `[manual]`-tagged ACs only)

- **AC**: per-plan AC #4 (operator walkthrough docs — inherits spec AC #13 `[manual]`).
- **Why manual**: a documentation walkthrough is prose correctness against a live flow, not an automatable assertion.
- **Verification protocol**:
  1. On a self-hosted (single-daemon) deployment, open a project's settings, choose the **Dockerfile** source, paste `RUN sudo apt-get update && sudo apt-get install -y protobuf-compiler`, and Save.
  2. Confirm the card shows **Building…**, then **Verified** within the build budget; confirm the spawn log for a subsequent run for that project names the built image and the `dockerfile` source.
  3. Paste content that omits a required tool's dependency in a way that breaks the runtime (e.g. `RUN sudo rm /usr/local/bin/cascade-tools`) and Save; confirm the card shows **Failed** with a `runtime requirement missing:` reason and that runs still refuse to launch (fail-closed).
  4. Restore valid content, Save, confirm Verified; then click **Rebuild** and confirm it rebuilds and re-verifies.
  5. Set a referenced image instead and confirm the Dockerfile control clears (mutual exclusivity).
  6. Confirm the README + getting-started steps match what you just did, including the single-daemon note.

---

## Acceptance Criteria (per-plan, testable)

1. A superadmin can choose the image source and, for Dockerfile, paste content into a textarea and Set/Clear it via the dashboard, calling `projects.update({workerDockerfile})`; the control is hidden for non-superadmins (spec AC #2 dashboard half).
2. The card renders `building` (spinner) and distinguishes the active-image status from a failed **rebuild** (active image stays "Verified" with a "last rebuild failed" note), and polls while a build is in flight (spec AC #6).
3. A Rebuild button triggers `projects.rebuildWorkerImage`, and selecting the Dockerfile source hides the reference-image control (mutual exclusivity) (spec AC #8, #3 UX).
4. Operator docs (README + getting-started) walk through the full flow including build/verify/fail, rebuild, mutual exclusivity, and the single-daemon constraint (spec AC #13 `[manual]`).
5. All new/modified UI code has corresponding tests.
6. `npm run build` (root) + `cd web && npm run build` pass; `npm test` passes; `npm run lint` + `npm run typecheck` pass (both workspaces).
7. Documentation Impact updated.

---

## Documentation Impact (this plan only)

| File | Change |
|---|---|
| `README.md` | Worker-image section: add the Dockerfile-source option ("extra layers only; base supplied for you"), mutual exclusivity with a referenced image, single-daemon constraint. |
| `docs/getting-started.md` | Operator walkthrough: write extra layers → save (dashboard/CLI/API) → build/verify/fail → rebuild for a refreshed base. |
| `CHANGELOG.md` | User-visible: dashboard control to set a per-project worker Dockerfile with live build status + rebuild. |

---

## Out of Scope (this plan)

- Any backend behavior (plans 1–4).
- Registry push / multi-host, build secrets, full arbitrary Dockerfiles, base-bump fan-out (spec Out of Scope).

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
