---
id: 025
slug: pr-comment-completion-and-codex-resume
plan: 2
plan_slug: pr-response-evidence
level: plan
parent_spec: docs/specs/025-pr-comment-completion-and-codex-resume.md
depends_on: [1-completion-alternatives.md]
status: pending
---

# 025/2: PR-response evidence — producers, plumbing, and `session finish`

> Part 2 of 3 in the 025-pr-comment-completion-and-codex-resume plan. Parent spec: resolve `docs/specs/025-pr-comment-completion-and-codex-resume.md*` (it may have been renamed `.done`).

## Summary

Plan 1 defined what counts as a comment-only completion; this plan makes the system produce that evidence and lets the agent finish on it. `cascade-tools scm post-pr-comment` and `cascade-tools scm reply-to-review-comment` record a successful new response in a PR-response sidecar (`CASCADE_PR_RESPONSE_SIDECAR_PATH`), while `cascade-tools scm update-pr-comment` records nothing — editing the acknowledgment or a progress comment is never a substantive response. The sidecar path is created and injected only for profiles that declare the `pr-response` alternative, and its env var is allowlisted so it actually reaches engine subprocesses. The in-process gadgets used by the SDK engine record the same fact in session state so `Finish` behaves identically there.

`cascade-tools session finish` (and the in-process `Finish` gadget) learn the same rule the shared evaluator applies: when the profile declares the alternative, a recorded response with a clean tree, no unpushed commits, and HEAD still at the run-start SHA is a valid finish; in that case the pushed-changes sidecar is **not** written, because nothing was pushed. Otherwise the strict push path is unchanged, with rejection messages that now name both ways to finish. `secretOrchestrator` populates the new `CompletionRequirements` fields (`pushedChangesAlternatives`, `prResponseSidecarPath`, `repoDir`, `initialHeadSha`) so the worker-side evaluation from plan 1 runs on real data.

Still dormant for users: no built-in profile declares the alternative until plan 3.

**Components delivered:**
- `src/gadgets/sessionState.ts` — `PR_RESPONSE_SIDECAR_ENV_VAR`, `recordPRResponse`, `getPRResponse`
- `src/backends/shared/envFilter.ts` — allowlist entry
- `src/gadgets/session/core/sidecar.ts` — `writePRResponseSidecar`
- `src/cli/scm/post-pr-comment.ts`, `src/cli/scm/reply-to-review-comment.ts` — sidecar writes after success
- `src/gadgets/github/PostPRComment.ts`, `src/gadgets/github/ReplyToReviewComment.ts` — session-state records
- `src/backends/sidecarManager.ts`, `src/backends/secretOrchestrator.ts` — path creation, env injection, requirement fields
- `src/gadgets/session/core/finish.ts`, `src/cli/session/finish.ts`, `src/gadgets/Finish.ts` — comment-only finish acceptance

**Files owned (exclusive to this plan within this spec):**
- `src/gadgets/sessionState.ts`
- `src/backends/shared/envFilter.ts`
- `src/gadgets/session/core/sidecar.ts`
- `src/gadgets/session/core/finish.ts`
- `src/cli/session/finish.ts`
- `src/gadgets/Finish.ts`
- `src/cli/scm/post-pr-comment.ts`
- `src/cli/scm/reply-to-review-comment.ts`
- `src/gadgets/github/PostPRComment.ts`
- `src/gadgets/github/ReplyToReviewComment.ts`
- `src/backends/sidecarManager.ts`
- `src/backends/secretOrchestrator.ts`
- `tests/unit/gadgets/sessionState.test.ts`
- `tests/unit/backends/shared-envFilter.test.ts`
- `tests/unit/gadgets/session/core/sidecar.test.ts`
- `tests/unit/gadgets/session/core/finish.test.ts`
- `tests/unit/gadgets/session/core/finish-real-git.test.ts`
- `tests/unit/cli/session/finish.test.ts`
- `tests/unit/cli/scm/post-pr-comment-sidecar.test.ts` (new)
- `tests/unit/cli/scm/reply-to-review-comment-sidecar.test.ts` (new)
- `tests/unit/cli/scm/scm-commands.test.ts`
- `tests/unit/gadgets/github/` posting-gadget tests (new file `pr-response-record.test.ts`)
- `tests/unit/backends/sidecarManager.test.ts`

**Shared surfaces (append-only, conflicts are trivial):**
- `CHANGELOG.md` (one block under *Unreleased → Changed*)

**Deferred to later plans in this spec:**
- The profile opt-in, prompt guidance, end-to-end proof and architecture docs — plan 3.

---

## Spec ACs satisfied by this plan

- Spec AC #1 (question → completes without commit) — **partial (this plan: the response is recorded and `session finish` accepts it; plan 3 opts the agent in and proves the run completes)**
- Spec AC #2 (changed files, not pushed → no completion) — **partial (this plan: `session finish` rejects a dirty/moved repository even with a recorded response, with an actionable reason; plan 1 gates the worker side; plan 3 proves it)**
- Spec AC #4 (editing the acknowledgment/progress comment does not count) — **full**
- Spec AC #6 (no duplicate response on continuation) — **partial (this plan: the sidecar survives across turns so the plan-1 prompt can name it; plan 3 asserts end to end)**
- Spec AC #7 (identical across native-tool engines) — **partial (this plan: one env var, one sidecar shape, one `validateFinish`; the in-process gadgets mirror it for SDK parity)**

---

## Depends On

- Plan 1 (completion-alternatives) — provides `PushedChangesAlternative`, the `CompletionRequirements` fields (`pushedChangesAlternatives`, `prResponseSidecarPath`, `repoDir`, `initialHeadSha`), `PR_RESPONSE_KINDS` / `PRResponseKind`, and `readCompletionEvidence` reading the response sidecar (reused by the `session finish` CLI).

---

## Detailed Task List (TDD)

### 1. Session state + env plumbing

**Tests first** (`tests/unit/gadgets/sessionState.test.ts`):

- `PR_RESPONSE_SIDECAR_ENV_VAR is CASCADE_PR_RESPONSE_SIDECAR_PATH` — unit — Expected red: `undefined`.
- `recordPRResponse / getPRResponse round-trip` — unit — record `{ url, kind: 'inline-reply' }` → `getPRResponse()` returns it; fresh state returns `null`. Expected red: `recordPRResponse is not a function`.
- `initSessionState resets the recorded response` — unit — record, re-init → `null`. Expected red: stale value survives.

**Tests first** (`tests/unit/backends/shared-envFilter.test.ts`): the existing constant sweep ("every constant in `sessionState.ts` is allowlisted") goes red on its own once the new constant exists — `expected CASCADE_PR_RESPONSE_SIDECAR_PATH to be allowlisted`. Keep it as the red; add the explicit import to the test's constant list so the sweep stays exhaustive.

**Implementation** (`src/gadgets/sessionState.ts`, `src/backends/shared/envFilter.ts`):
- `export const PR_RESPONSE_SIDECAR_ENV_VAR = 'CASCADE_PR_RESPONSE_SIDECAR_PATH';`
- `SessionStateData.prResponse: { url: string; kind: PRResponseKind } | null` (reset in `initSessionState`), `recordPRResponse(url, kind)`, `getPRResponse()`.
- Add `PR_RESPONSE_SIDECAR_ENV_VAR` to `SHARED_ALLOWED_ENV_EXACT` in the sidecar block.

### 2. Sidecar writer

**Tests first** (`tests/unit/gadgets/session/core/sidecar.test.ts`):

- `writePRResponseSidecar writes the contract shape` — unit — path + `{ url, kind: 'top-level', id: 5, prNumber: 7, command: 'cascade-tools scm post-pr-comment' }` → file equals `{ source: command, url, kind, id, prNumber }` and returns `true`. Expected red: `writePRResponseSidecar is not a function`.
- `refuses to write without a url` — unit — `url: ''` → returns `false`, no file, `logger.error` called. Expected red: as above.
- `refuses an unknown kind` — unit — `kind: 'edit'` → `false`. Expected red: as above.
- `returns false quietly when the path is unset` — unit — `undefined` path → `false` and **no WARN** (only DEBUG) — unlike the other writers, most agents legitimately run without this path. Expected red: as above.

**Implementation** (`src/gadgets/session/core/sidecar.ts`):
- `export function writePRResponseSidecar(sidecarPath: string | undefined, response: { url: string; kind: PRResponseKind; id: number; prNumber: number | null; command: string }): boolean` — validates `url` non-empty and `kind ∈ PR_RESPONSE_KINDS` (imported from `completion.ts`), writes `JSON.stringify({ source: command, url, kind, id, prNumber })`, DEBUG when unset, WARN on write failure. Overwrites: the latest successful response is the recorded one (plan 1 only needs "at least one").

### 3. Producers: CLI commands and in-process gadgets

**Tests first** (`tests/unit/cli/scm/post-pr-comment-sidecar.test.ts`, mirroring `create-pr-sidecar.test.ts`):

- `writes the PR-response sidecar with kind top-level after a successful post` — unit — mock `postPRComment` to resolve `{ id: 11, url: 'https://…#issuecomment-11', repoFullName, prNumber: 7 }`, set `CASCADE_PR_RESPONSE_SIDECAR_PATH` → file has `kind: 'top-level'`, `source: 'cascade-tools scm post-pr-comment'`, `id: 11`, `prNumber: 7`. Expected red: file missing.
- `does not write when the post fails` — unit — core rejects → no file, command exits non-zero as before. Expected red: n/a until the writer is wired; assert the file is absent so a naïve "always write" implementation goes red.

(`tests/unit/cli/scm/reply-to-review-comment-sidecar.test.ts`): same two tests with `kind: 'inline-reply'` and `source: 'cascade-tools scm reply-to-review-comment'`.

(`tests/unit/cli/scm/scm-commands.test.ts`): `update-pr-comment leaves the PR-response sidecar untouched` — unit — env var set, run the command with a mocked successful update → no file. This negative assertion guards a live boundary (the editing tool stays reachable and must never count). Expected red: n/a — it must be green from the start and stay green; pair it with the two positive tests so the suite proves the asymmetry.

(`tests/unit/gadgets/github/pr-response-record.test.ts`): `PostPRComment gadget records a top-level response in session state` and `ReplyToReviewComment gadget records an inline reply` — unit — mock the core, run the gadget, `getPRResponse()` returns `{ url, kind }`. Expected red: `null`.

**Implementation** (`src/cli/scm/post-pr-comment.ts`, `src/cli/scm/reply-to-review-comment.ts`, `src/gadgets/github/PostPRComment.ts`, `src/gadgets/github/ReplyToReviewComment.ts`):
- CLI handlers: after the core resolves, `writePRResponseSidecar(process.env[PR_RESPONSE_SIDECAR_ENV_VAR], { url: result.url, kind, id: result.id, prNumber: result.prNumber, command })` (same pattern as `create-pr.ts`). `result.url` may be undefined in the mutation-result type — treat that as "no evidence" (writer refuses) rather than throwing; the comment still posted.
- Gadgets: `recordPRResponse(result.url, kind)` after success. `update-pr-comment.ts` / `UpdatePRComment.ts` untouched.

### 4. Sidecar path creation and requirement fields

**Tests first** (`tests/unit/backends/sidecarManager.test.ts`):

- `creates the PR-response sidecar path only for profiles declaring the pr-response alternative` — unit — profile `finishHooks: { requiresPushedChanges: true, pushedChangesAlternatives: ['pr-response'] }`, `needsNativeToolRuntime: true` → returned `prResponseSidecarPath` is a temp path and `projectSecrets.CASCADE_PR_RESPONSE_SIDECAR_PATH` equals it. Expected red: `prResponseSidecarPath` undefined.
- `does not create it for a plain requiresPushedChanges profile` — unit — → `undefined`, env var absent. Expected red: n/a (green pin).
- `does not create it without a native-tool runtime` — unit — `needsNativeToolRuntime: false` → `undefined`. Expected red: n/a (green pin, mirrors the other sidecars).

Existing `secretOrchestrator` coverage lives in `tests/unit/backends/adapter.test.ts` (plan 1 file) — so pin the requirement fields here instead: `tests/unit/backends/sidecarManager.test.ts` gains `buildCompletionRequirements maps sidecar paths, alternatives, repoDir and initialHeadSha` — unit — extract the object literal at `secretOrchestrator.ts:220` into `buildCompletionRequirements(profile, artifacts, repoDir, input)` in `sidecarManager.ts` and assert the mapping (`pushedChangesAlternatives` from the profile, `repoDir` as given, `initialHeadSha === input.headSha`, `maxContinuationTurns: 2`). Expected red: `buildCompletionRequirements is not a function`.

**Implementation** (`src/backends/sidecarManager.ts`, `src/backends/secretOrchestrator.ts`):
- `createCompletionArtifacts` adds `prResponseSidecarPath` (`cascade-pr-response-sidecar-<pid>-<ts>.json`) when `needsNativeToolRuntime && profile.finishHooks.pushedChangesAlternatives?.includes('pr-response')`, injects the env var, returns it.
- `export function buildCompletionRequirements(...)`: returns the `CompletionRequirements` object (moved from `secretOrchestrator.ts`) with the four new fields. `initialHeadSha` is `input.headSha` — the same value the CLI already receives as `CASCADE_INITIAL_HEAD_SHA`, so the worker-side and CLI-side "HEAD unchanged" checks agree by construction. (Deriving it from `git rev-parse HEAD` would newly enforce the no-new-commits rule on PM-triggered runs — a behaviour change outside this spec.)
- `secretOrchestrator.ts` calls the helper; nothing else changes there.

### 5. `session finish` accepts the comment-only outcome

**Tests first** (`tests/unit/gadgets/session/core/finish.test.ts` — mocked git helpers, and `finish-real-git.test.ts` — real temp repo):

- `accepts a recorded PR response when the tree is clean, nothing is unpushed, and HEAD is unchanged` — unit (mocked) — hooks `{ requiresPushedChanges: true, pushedChangesAlternatives: ['pr-response'] }`, `prResponse: { url, kind }`, `initialHeadSha` set, `hasUncommittedChanges → false`, `hasUnpushedCommits → false`, `hasNewCommits → false` → `{ valid: true, pushedChangesOutcome: 'pr-response' }`. Expected red: `{ valid: false, error: /without making any changes/ }`.
- `reports pushed-changes as the outcome when new commits were pushed` — unit — `hasNewCommits → true` → `{ valid: true, pushedChangesOutcome: 'pushed-changes' }`. Expected red: `pushedChangesOutcome` undefined.
- `rejects a recorded response when the tree is dirty, naming both ways out` — unit — `hasUncommittedChanges → true` → `valid: false`, error matches `/commit and push/` and `/revert/`. Expected red: legacy message without `revert`.
- `rejects a recorded response when HEAD moved without a push` — unit — `hasNewCommits → true`, `hasUnpushedCommits → true` → `valid: false`, error `/push/`. Expected red: n/a (already rejects) — assert the message still mentions the response was kept, i.e. `/already posted/`, for its own red.
- `does not accept the alternative without an initial HEAD SHA` — unit — `initialHeadSha: null` → strict path (fail closed): with no new commits detectable the legacy behaviour applies (`valid: true` only if the legacy checks pass) and `pushedChangesOutcome === 'pushed-changes'`; document in the test why. Expected red: `'pr-response'` reported.
- `ignores a recorded response when the profile declares no alternative` — unit — `prResponse` set, hooks `{ requiresPushedChanges: true }`, no new commits → `valid: false` with the legacy `no_new_commits` error. Expected red: n/a (green pin for spec AC #8).
- `rejects with the two-way message when nothing was recorded and nothing changed` — unit — alternatives declared, `prResponse: null`, no changes → `valid: false`, error `/post-pr-comment/` and `/commit and push/`. Expected red: legacy message.
- (`finish-real-git.test.ts`) `comment-only finish in a real repository` — unit — temp repo at commit A, `initialHeadSha = A`, response recorded → `valid: true, pushedChangesOutcome: 'pr-response'`; then `touch file` → `valid: false`. Expected red: first assertion fails with the legacy error.

(`tests/unit/cli/session/finish.test.ts`):
- `passes the PR-response sidecar into validation and skips the pushed-changes sidecar for a comment-only finish` — unit — env `CASCADE_PR_RESPONSE_SIDECAR_PATH` → a valid sidecar, mocked `validateFinish` returning `{ valid: true, pushedChangesOutcome: 'pr-response' }` → `validateFinish` received `prResponse: { url, kind }` and `writePushedChangesSidecar` was **not** called. Expected red: `writePushedChangesSidecar` called.
- `writes the pushed-changes sidecar for a pushed-changes finish` — unit — outcome `'pushed-changes'` → called once (regression pin). Expected red: n/a.

(`tests/unit/gadgets/session/core/finish.test.ts` or a small `tests/unit/gadgets/Finish.test.ts` if absent): the in-process `Finish` gadget passes `getPRResponse()` into `validateFinish` and applies the same sidecar rule. Expected red: `validateFinish` called without `prResponse`.

**Implementation** (`src/gadgets/session/core/finish.ts`, `src/cli/session/finish.ts`, `src/gadgets/Finish.ts`):
- `SessionState` gains `prResponse?: { url: string; kind: PRResponseKind } | null`.
- `FinishValidationSuccess` becomes `{ valid: true; pushedChangesOutcome?: 'pushed-changes' | 'pr-response' }`.
- `checkPushedChangesHook(state)` returns `FinishValidationError | { pushedChangesOutcome }`:
  1. If `state.hooks.pushedChangesAlternatives?.includes('pr-response') && state.prResponse && state.initialHeadSha` and `!hasUncommittedChanges() && !hasUnpushedCommits(prBranch) && !hasNewCommits(initialHeadSha)` → `logger.info('[Finish] comment-only outcome accepted', { url, kind })`, outcome `'pr-response'`.
  2. Otherwise the existing three checks run unchanged in order; when alternatives are declared, the `uncommitted_changes` and `no_new_commits` messages are replaced by the two-way texts (constants: `FINISH_ERROR_DIRTY_WITH_RESPONSE`, `FINISH_ERROR_NOTHING_TO_FINISH`); when a response is recorded the message begins with "Your PR response was already posted at {url} — do not post it again." A passing strict path reports `'pushed-changes'`.
- `validateFinish` propagates the outcome. `cli/session/finish.ts` reads `readCompletionEvidence({ prResponseSidecarPath: process.env[PR_RESPONSE_SIDECAR_ENV_VAR], … }).prResponse` into the state and writes the pushed-changes sidecar only when `result.pushedChangesOutcome === 'pushed-changes'`. `gadgets/Finish.ts` does the same with `getPRResponse()`.

---

## Test Plan

### Unit tests
- [ ] `tests/unit/gadgets/sessionState.test.ts`: 3 tests — constant, record/get, reset
- [ ] `tests/unit/backends/shared-envFilter.test.ts`: existing sweep + 1 explicit entry
- [ ] `tests/unit/gadgets/session/core/sidecar.test.ts`: 4 tests — writer contract
- [ ] `tests/unit/cli/scm/post-pr-comment-sidecar.test.ts`: 2 tests
- [ ] `tests/unit/cli/scm/reply-to-review-comment-sidecar.test.ts`: 2 tests
- [ ] `tests/unit/cli/scm/scm-commands.test.ts`: 1 test — update never records
- [ ] `tests/unit/gadgets/github/pr-response-record.test.ts`: 2 tests — in-process records
- [ ] `tests/unit/backends/sidecarManager.test.ts`: 4 tests — path creation + requirement mapping
- [ ] `tests/unit/gadgets/session/core/finish.test.ts`: 7 tests — acceptance/rejection matrix
- [ ] `tests/unit/gadgets/session/core/finish-real-git.test.ts`: 1 test — real repo
- [ ] `tests/unit/cli/session/finish.test.ts`: 2 tests — sidecar rule
- [ ] in-process `Finish` gadget: 1 test

### Integration tests
- [ ] none required — GitHub calls are mocked at the core boundary exactly as the existing sidecar tests do.

### Acceptance tests
- [ ] Per-plan ACs 1–7 map onto the groups above.

---

## Manual Verification (for `[manual]`-tagged ACs only)

*n/a — all ACs auto-tested.*

---

## Acceptance Criteria (per-plan, testable)

1. A successful `cascade-tools scm post-pr-comment` writes `{ source, url, kind: 'top-level', id, prNumber }` to `CASCADE_PR_RESPONSE_SIDECAR_PATH`; `reply-to-review-comment` writes `kind: 'inline-reply'`; a failed post writes nothing; `update-pr-comment` never writes it. (spec AC #4)
2. The in-process `PostPRComment` / `ReplyToReviewComment` gadgets record the same fact in session state. (spec AC #7)
3. The env var is allowlisted and the sidecar path is created and injected only for native-tool runs of profiles that declare `pr-response`; `CompletionRequirements` carries `pushedChangesAlternatives`, `prResponseSidecarPath`, `repoDir`, and `initialHeadSha === input.headSha`. (spec AC #1)
4. `validateFinish` accepts a recorded response only with a clean tree, no unpushed commits, an unchanged HEAD, and an initial SHA to compare against, reporting `pushedChangesOutcome: 'pr-response'`; every other case follows the strict path and reports `'pushed-changes'` when it passes. (spec ACs #1, #2)
5. With alternatives declared, rejection messages name both ways to finish and, when a response exists, state its URL and that it must not be posted again; without alternatives the messages are unchanged. (spec ACs #2, #6, #8)
6. `session finish` (CLI and gadget) writes the pushed-changes sidecar only for the `'pushed-changes'` outcome.
7. Running any built-in agent still creates no PR-response sidecar path (no profile opts in yet).
8. All new/modified code has corresponding tests.
9. `npm run build` passes.
10. `npm test` passes.
11. `npm run lint` and `npm run typecheck` pass.
12. All documentation listed in Documentation Impact has been updated.

**Partial-state criterion:**
- The two posting commands write a sidecar only when `CASCADE_PR_RESPONSE_SIDECAR_PATH` is set, and nothing sets it for a built-in agent yet; `session finish` only takes the new branch when a profile declares `pr-response`. Observable behaviour for every agent is unchanged.

---

## Documentation Impact (this plan only)

| File | Change |
|---|---|
| `CHANGELOG.md` | *Unreleased → Changed*: `post-pr-comment` / `reply-to-review-comment` record authoritative response evidence when `CASCADE_PR_RESPONSE_SIDECAR_PATH` is set; `session finish` accepts a comment-only outcome for profiles that declare `pr-response`. |

The `cascade-tools` flag/usage surface is unchanged, so `src/gadgets/README.md` and the CLI help need no edit.

---

## Out of Scope (this plan)

- Opting `respond-to-pr-comment` in, its prompt guidance, end-to-end tests, architecture docs — plan 3.
- Judging whether a posted comment is "substantive" by content — the spec counts any successful new top-level comment or inline reply (strategic decision 2).
- Spec-level exclusions as listed in plan 1.

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
- [ ] AC #11
- [ ] AC #12
