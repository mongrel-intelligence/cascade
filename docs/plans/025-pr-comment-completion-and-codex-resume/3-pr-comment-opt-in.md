---
id: 025
slug: pr-comment-completion-and-codex-resume
plan: 3
plan_slug: pr-comment-opt-in
level: plan
parent_spec: docs/specs/025-pr-comment-completion-and-codex-resume.md
depends_on: [2-pr-response-evidence.md]
status: pending
---

# 025/3: PR-comment agent opts in — guidance, end-to-end proof, documentation

> Part 3 of 3 in the 025-pr-comment-completion-and-codex-resume plan. Parent spec: resolve `docs/specs/025-pr-comment-completion-and-codex-resume.md*` (it may have been renamed `.done`).

## Summary

This plan turns the dormant machinery on for the one agent the spec targets. `respond-to-pr-comment.yaml` declares `pushedChangesAlternatives: [pr-response]`, and its task prompt tells the agent exactly how to satisfy either outcome: answer a question with `cascade-tools scm post-pr-comment` (or `reply-to-review-comment` inside an inline thread) without touching the repository and then `session finish`; make requested code changes, commit, push, then finish. No other definition changes.

The plan also carries the proof that the whole chain works: an end-to-end test drives the shared continuation loop with the real profile flags, the real sidecar writers, and a real temporary git repository, covering the question path (completes with no commit), the modified-but-unpushed path (does not complete; actionable reason; the recorded response is named and not requested again), the pushed-changes path, malformed evidence, and the fact that every other pushed-changes agent still fails without a push. A structural test pins that all three native-tool engines go through the shared loop. Finally, the architecture documentation describes the response-or-push contract and evidence-driven continuation, and `adding-engines.md` gains the requirement that continuation-capable engines preserve session identity and pass the model-free grammar check that PR #1554 introduced.

**Components delivered:**
- `src/agents/definitions/respond-to-pr-comment.yaml` — opt-in + guidance
- `tests/unit/agents/definitions/respond-to-pr-comment.yaml.test.ts` — profile contract (new)
- `tests/unit/backends/pr-comment-completion.test.ts` — end-to-end (new)
- `tests/unit/backends/native-tool-continuation-parity.test.ts` — engine parity (new)
- `docs/architecture/04-agent-system.md`, `docs/architecture/05-engine-backends.md`, `docs/adding-engines.md`, `docs/areas/agents.md`, `CHANGELOG.md`

**Files owned (exclusive to this plan within this spec):**
- `src/agents/definitions/respond-to-pr-comment.yaml`
- `tests/unit/agents/definitions/respond-to-pr-comment.yaml.test.ts`
- `tests/unit/backends/pr-comment-completion.test.ts`
- `tests/unit/backends/native-tool-continuation-parity.test.ts`
- `docs/architecture/04-agent-system.md`
- `docs/architecture/05-engine-backends.md`
- `docs/adding-engines.md`
- `docs/areas/agents.md`

**Shared surfaces (append-only, conflicts are trivial):**
- `CHANGELOG.md` (one block under *Unreleased → Fixed*)

**Deferred to later plans in this spec:**
- none — this is the last plan.

---

## Spec ACs satisfied by this plan

- Spec AC #1 (question → run completes with no commit) — **partial (this plan: opt-in + end-to-end proof; plans 1 and 2 supply evaluation and evidence)**
- Spec AC #2 (changed files, not pushed → continues or fails with an actionable pushed-change reason) — **partial (this plan: end-to-end proof)**
- Spec AC #3 (pushed changes complete under the strict path) — **partial (this plan: end-to-end reconfirmation; plan 1 holds the unit pin)**
- Spec AC #6 (continuation does not post the response again) — **partial (this plan: task guidance + end-to-end prompt assertion)**
- Spec AC #7 (behaviour identical across native-tool engines) — **partial (this plan: structural parity test)**
- Spec AC #8 (no other agent inherits the alternative) — **partial (this plan: definition sweep pins that only `respond-to-pr-comment` declares it)**

---

## Depends On

- Plan 2 (pr-response-evidence) — sidecar writers, env var, `session finish` acceptance, requirement plumbing.
- Plan 1 (completion-alternatives) — evaluator, prompt, logging (transitively).

---

## Detailed Task List (TDD)

### 1. Profile opt-in and guidance

**Tests first** (`tests/unit/agents/definitions/respond-to-pr-comment.yaml.test.ts`, shaped like `review.yaml.test.ts`):

- `declares the pr-response alternative next to requiresPushedChanges` — unit — `loadBuiltinDefinition('respond-to-pr-comment')` → `hooks.finish.scm` equals `{ requiresPushedChanges: true, blockGitPush: false, pushedChangesAlternatives: ['pr-response'] }`. Expected red: `pushedChangesAlternatives` undefined.
- `is the only built-in definition that declares an alternative` — unit — load every `src/agents/definitions/*.yaml`; exactly one has `pushedChangesAlternatives`. Expected red: n/a until the YAML changes (0 found → fails with "expected 1"), so it is red first.
- `tells the agent how to answer a question without touching the repository` — unit — YAML text matches `/cascade-tools scm post-pr-comment/`, `/reply-to-review-comment/`, `/without (changing|modifying) the repository|do not commit/i`, and `/cascade-tools session finish/`. Expected red: no match.
- `tells the agent to commit and push when code changes are requested` — unit — matches `/commit.*push/` and `/session finish/`. Expected red: partial match only (the push sentence exists today; the finish sentence does not).

**Implementation** (`src/agents/definitions/respond-to-pr-comment.yaml`):
- Under `hooks.finish.scm`: add `pushedChangesAlternatives: [pr-response]`.
- Task prompt: replace the final paragraph with explicit two-outcome guidance — question → reply via `cascade-tools scm post-pr-comment` (top-level) or `cascade-tools scm reply-to-review-comment` (when the comment is in an inline review thread), leave the working tree untouched, then `cascade-tools session finish`; code change → make surgical changes, commit, push, then `cascade-tools session finish`. State once that a reply is posted exactly once and never re-posted after a continuation.

### 2. End-to-end proof through the shared loop

**Tests first** (`tests/unit/backends/pr-comment-completion.test.ts`): each test builds a temp git repo (commit A), resolves the real profile via `getAgentProfile('respond-to-pr-comment')`, builds requirements with plan 2's `buildCompletionRequirements` (real sidecar paths in a temp dir), and drives `runContinuationLoop` with an `executeTurn` stub that performs the side effects a real agent would (calling the real `writePRResponseSidecar` / `writePushedChangesSidecar`, committing in the repo):

- `a question answered by a new comment completes on the first turn with no commit` — acceptance — turn 1 writes the response sidecar → result `success: true`, `executeTurn` called once, repo HEAD still A, INFO log `pushedChangesOutcome: 'pr-response'`. Expected red: `success: false` with the no-push error (before plan 3 opts in, the profile has no alternative — this test goes red on the YAML, not on code).
- `a modified but unpushed repository does not complete even with a posted comment` — acceptance — turn 1 writes the response sidecar and dirties the tree, `maxContinuationTurns: 1`, turn 2 does nothing → `success: false`, `error === COMPLETION_ERROR_NO_PUSH_OR_RESPONSE`, the turn-2 prompt contains the response URL and `/do not post/i`, and `executeTurn` called exactly twice. Expected red: turn-2 prompt lacks the URL / error is the legacy string.
- `the continuation prompt never asks for a second response once one is recorded` — acceptance — same setup; assert the turn-2 prompt does **not** match `/post-pr-comment/` as an instruction to post (it may appear inside the "already posted" sentence only — assert with the exact prompt constant from plan 1). Expected red: prompt asks to post.
- `requested code changes complete through the strict pushed-changes path` — acceptance — turn 1 commits B and writes the pushed-changes sidecar → `success: true`, log `pushedChangesOutcome: 'pushed-changes'`. Expected red: n/a (green pin for spec AC #3).
- `a malformed response sidecar satisfies nothing and the reason says so` — acceptance — turn 1 writes `{not json` → after exhaustion `success: false`, rejections include `/malformed/`. Expected red: rejections undefined.
- `every other pushed-changes agent still fails without a push` — acceptance — for each built-in definition with `requiresPushedChanges: true` other than `respond-to-pr-comment` (`implementation`, `respond-to-ci`, `respond-to-review`, `resolve-conflicts`, plus any future one — enumerate from disk), write a response sidecar, clean repo, no push → `success: false`, `error === COMPLETION_ERROR_NO_PUSH`. Expected red: n/a (green pin for spec AC #8; enumerating from disk makes a future opt-in show up here).

**Tests first** (`tests/unit/backends/native-tool-continuation-parity.test.ts`):

- `every native-tool engine drives turns through runContinuationLoop` — unit — for each engine directory `claude-code`, `codex`, `opencode`, the `index.ts` source imports `runContinuationLoop` from `../shared/continuationLoop.js` and calls it; the completion decision therefore has exactly one implementation. Expected red: n/a today (all three already do) — this is the guard for spec AC #7; it must fail if an engine grows its own loop.

**Implementation:** none beyond section 1 — these tests exercise plans 1–3 together. If any goes red for a reason other than the YAML, the defect is in plan 1 or 2 and must be fixed there (edit that plan in place per the divergence rule).

### 3. Documentation

**Tests first** (`tests/unit/architecture-docs.test.ts` already guards `docs/areas/*` ≤ 60 lines, no ticket IDs/dates): the `docs/areas/agents.md` bullet below must keep that suite green. No new test.

**Implementation:**
- `docs/architecture/04-agent-system.md` — *Finish hooks* table: add `scm.pushedChangesAlternatives` ("outcomes that satisfy `requiresPushedChanges` instead of a push; `pr-response` = a new top-level PR comment or inline reply, recorded by `cascade-tools scm post-pr-comment` / `reply-to-review-comment`, with a clean tree and HEAD unchanged since run start"). Add a short *Response-or-push completion* subsection: which evidence counts, that editing the ack/progress comment never counts, fail-closed evaluation, and that only `respond-to-pr-comment` opts in.
- `docs/architecture/05-engine-backends.md` — under *Continuation loop*: evidence-driven continuation (sidecars + repository state), the `pushedChangesOutcome` log line, per-outcome rejections, and the rule that a continuation prompt names an already-recorded response so a resumed session never repeats it. The Codex resume grammar sentence added by PR #1553 stays.
- `docs/adding-engines.md` — checklist item: a continuation-capable engine must resume the same session on continuation turns (never start a fresh one) and must pass the model-free grammar probe (`dist/backends/codex/grammarSmokeCli.js` pattern) at image-build time when it is subprocess-based.
- `docs/areas/agents.md` — one bullet: completion alternatives are declared per profile in YAML; never add agent-name conditionals to `src/backends/completion.ts`.
- `CHANGELOG.md` — *Unreleased → Fixed*: "A PR-comment run that answers a question now completes without an artificial commit" — user-visible behaviour, how it is evidenced, what still fails, and the log line operators can grep.

---

## Test Plan

### Unit tests
- [ ] `tests/unit/agents/definitions/respond-to-pr-comment.yaml.test.ts`: 4 tests — opt-in, uniqueness, guidance
- [ ] `tests/unit/backends/native-tool-continuation-parity.test.ts`: 1 test — engine parity guard

### Integration tests
- [ ] none — the end-to-end tests below use real git and real sidecar writers but mock nothing external, so they run in the unit project.

### Acceptance tests
- [ ] `tests/unit/backends/pr-comment-completion.test.ts`: 6 tests — spec ACs #1, #2, #3, #5, #6, #8 end to end

---

## Manual Verification (for `[manual]`-tagged ACs only)

*n/a — all ACs auto-tested.*

---

## Acceptance Criteria (per-plan, testable)

1. `respond-to-pr-comment` is the only built-in definition declaring `pushedChangesAlternatives`, and its value is `[pr-response]`. (spec AC #8)
2. Its task prompt names both finishing paths (reply tool + untouched repository + `session finish`; commit + push + `session finish`) and says a reply is posted once. (spec ACs #1, #6)
3. Driving the shared loop with the real profile, real sidecar writers and a real repository: a question path completes with HEAD unchanged; a dirty/unpushed path does not complete and its continuation prompt names the recorded response and does not request another; a pushed path completes; a malformed sidecar is rejected with a reason naming the malformation. (spec ACs #1, #2, #3, #5, #6)
4. Every other pushed-changes agent fails without a push even when a response sidecar exists. (spec AC #8)
5. All three native-tool engines route turns through `runContinuationLoop`. (spec AC #7)
6. `04-agent-system.md`, `05-engine-backends.md`, `adding-engines.md`, `docs/areas/agents.md` and `CHANGELOG.md` describe the contract as listed above, and `tests/unit/architecture-docs.test.ts` stays green.
7. All new/modified code has corresponding tests.
8. `npm run build` passes.
9. `npm test` passes.
10. `npm run lint` and `npm run typecheck` pass.
11. All documentation listed in Documentation Impact has been updated.

---

## Documentation Impact (this plan only)

| File | Change |
|---|---|
| `docs/architecture/04-agent-system.md` | Finish-hooks table row for `pushedChangesAlternatives`; new *Response-or-push completion* subsection. |
| `docs/architecture/05-engine-backends.md` | Evidence-driven continuation semantics, outcome log line, rejections, no-repeat rule. |
| `docs/adding-engines.md` | Continuation-capable engines: preserve session identity; subprocess engines pass a model-free grammar probe at image build. |
| `docs/areas/agents.md` | One bullet: alternatives are declared in YAML; no agent-name conditionals in completion code. |
| `CHANGELOG.md` | *Fixed* entry for comment-only PR-comment completion. |

---

## Out of Scope (this plan)

- Comment-only completion for any agent other than `respond-to-pr-comment`.
- Pre-classifying comments as question vs. change request before dispatch.
- Dashboard changes, schema changes, historical-run retries, prompt/model/iteration changes beyond the guidance paragraph above.
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
