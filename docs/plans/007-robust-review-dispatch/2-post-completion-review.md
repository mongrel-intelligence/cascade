---
id: 007
slug: robust-review-dispatch
plan: 2
plan_slug: post-completion-review
level: plan
parent_spec: docs/specs/007-robust-review-dispatch.md
depends_on: [1-lock-infra.md]
status: pending
---

# 007/2: Post-completion review dispatch hook

> Part 2 of 2 in the 007-robust-review-dispatch plan. See [parent spec](../../specs/007-robust-review-dispatch.md).

## Summary

Plan 1 removed the false cross-type serialization so `check-suite-success` webhooks can dispatch the review while the implementation container is still shutting down. But the review is still at the mercy of webhook timing: if all CI-completion webhooks arrive and are processed during the narrow window before the lock is released, there's no second chance.

This plan adds a **deterministic** review dispatch: when the implementation agent completes successfully with a PR URL, the agent execution pipeline itself (running inside the worker container, before exit) checks whether the PR has green CI and no review already dispatched, and if so, enqueues a review job directly via BullMQ. This fires before the container exits, guaranteeing the review dispatch within seconds of implementation completion.

The hook reuses the existing `claimReviewDispatch` dedup mechanism so a subsequent `check-suite-success` webhook doesn't double-enqueue a second review.

**Components delivered:**
- `src/triggers/shared/agent-execution.ts` — post-completion review-dispatch logic inside `runAgentExecutionPipeline`, after implementation success
- Helper to enqueue a review BullMQ job from within the worker container (new small module or inline in agent-execution)
- Dedup via `claimReviewDispatch` / `buildReviewDispatchKey` (reuse from `src/triggers/github/review-dispatch-dedup.ts`)
- CI-status check via `githubClient.getCheckSuiteStatus` (reuse from `src/triggers/github/pr-ready-to-merge.ts`)
- Tests for the new hook

**Deferred (out of spec scope):**
- Generalizing the hook to other trigger chains (splitting → planning, etc.)

---

## Spec ACs satisfied by this plan

- **Spec AC #1** (review within 30s after implementation + green CI) — **full**: the hook fires from the execution pipeline before container exit, deterministically.
- **Spec AC #5** (no double-enqueue with hook + webhook) — **full**: `claimReviewDispatch` dedup prevents the `check-suite-success` webhook from enqueuing a second review after the hook already fired.
- **Spec AC #1** (partial from plan 1 → now **complete**): the 30s guarantee is satisfied by the hook, not by the lock fix alone.

---

## Depends On

- **Plan 1 (lock-infra)** — provides per-type locking so the review job enqueued by the hook is not blocked by the implementation's lock.

---

## Detailed Task List (TDD)

### 1. Post-completion review check + enqueue

**Tests first** (`tests/unit/triggers/shared/agent-execution.test.ts` — extend the existing `runAgentExecutionPipeline` test suite):

- `fires review dispatch after successful implementation with prUrl and green CI` — mock `agentType = 'implementation'`, `agentResult.success = true`, `agentResult.prUrl = 'https://...'`, mock `githubClient.getCheckSuiteStatus` to return `{ allPassing: true }`, mock `claimReviewDispatch` to return `true` (not yet dispatched). Assert: a review BullMQ job is enqueued with the correct `TriggerResult` shape.
- `does NOT fire review dispatch when agentType is not implementation` — `agentType = 'review'`, same success result. Assert: no review job enqueued.
- `does NOT fire review dispatch when implementation failed` — `agentResult.success = false`. Assert: no review job enqueued.
- `does NOT fire review dispatch when implementation has no prUrl` — `agentResult.prUrl = undefined`. Assert: no review job enqueued.
- `does NOT fire review dispatch when CI is not all green` — `getCheckSuiteStatus` returns `{ allPassing: false }`. Assert: no review job enqueued.
- `does NOT fire review dispatch when claimReviewDispatch returns false (already dispatched)` — mock `claimReviewDispatch` to return `false`. Assert: no review job enqueued, log message indicates "review already dispatched".
- `does NOT fire review dispatch when project has no repo` — `project.repo` is undefined. Assert: no review job enqueued.
- `swallows errors gracefully — does not break the implementation pipeline` — mock `getCheckSuiteStatus` to throw. Assert: implementation pipeline completes normally, error is logged as warn.

**Implementation** (`src/triggers/shared/agent-execution.ts`):

- In `runAgentExecutionPipeline`, after the `linkPRPostExecution` block (line ~465), add a new block:

```ts
// Post-completion review dispatch: when an implementation agent succeeds
// with a PR, check CI and fire review deterministically. This guarantees
// review dispatch within seconds of completion, regardless of webhook timing.
if (
    agentType === 'implementation' &&
    agentResult.success &&
    agentResult.prUrl &&
    project.repo
) {
    await tryDispatchPostCompletionReview(agentResult, project, config, executionConfig);
}
```

- New function `tryDispatchPostCompletionReview(agentResult, project, config, executionConfig)`:
  1. Extract `prNumber` from `agentResult.prUrl` via `extractPRNumber`.
  2. Parse `owner/repo` via `parseRepoFullName(project.repo)`.
  3. Get `headSha` from `githubClient.getPR(owner, repo, prNumber).headSha`.
  4. Check CI: `githubClient.getCheckSuiteStatus(owner, repo, headSha)`. If not `allPassing`, return (CI not yet green — the `check-suite-success` webhook will handle it when CI finishes).
  5. Dedup: `claimReviewDispatch(buildReviewDispatchKey(owner, repo, prNumber, headSha), 'post-completion-hook', { ... })`. If returns false, return (already dispatched via webhook).
  6. Build `TriggerResult` matching what `check-suite-success` would produce: `{ agentType: 'review', agentInput: { prNumber, prBranch, repoFullName, headSha, triggerType: 'post-completion', triggerEvent: 'scm:check-suite-success', workItemId }, prNumber, prUrl, prTitle, workItemId }`.
  7. Enqueue via the shared execution pipeline: call `runAgentWithCredentials(integration, result, project, config, executionConfig)` — or, if running inside the worker container where credentials are already in scope, directly call `runAgentExecutionPipeline(result, project, config, { ...executionConfig, skipPrepareForAgent: true })`.

  The exact enqueue mechanism depends on whether the worker container can dispatch a BullMQ job or must reuse the in-process pipeline. Investigate during implementation: if `runAgentExecutionPipeline` for review runs in-process (within the same container), this is simplest. If it must be a separate container, enqueue a BullMQ job via a new `Queue('cascade-jobs')` instance (the worker has `REDIS_URL`).

  Wrap the entire function in `try/catch` — log warn on failure but never break the implementation pipeline.

### 2. Dedup integration

**Tests first** (`tests/unit/triggers/shared/agent-execution.test.ts`):

- `subsequent check-suite-success webhook does not enqueue review after post-completion hook already fired` — setup: call `runAgentExecutionPipeline` for implementation (which fires the hook and claims the dedup key). Then simulate a `check-suite-success` trigger for the same PR+SHA. Assert: the trigger's `claimReviewDispatch` returns false, no second review enqueued.

**Implementation:**
- Import `buildReviewDispatchKey`, `claimReviewDispatch` from `src/triggers/github/review-dispatch-dedup.ts`.
- The dedup key format is already `${owner}/${repo}:${prNumber}:${headSha}` — same key regardless of whether claimed by the webhook trigger or the post-completion hook.

### 3. Log the dispatch decision

**Tests first** (`tests/unit/triggers/shared/agent-execution.test.ts`):

- `logs the post-completion review dispatch decision at INFO` — when hook fires and enqueues, assert logger.info contains `'Post-completion review dispatch'` with `{ prNumber, workItemId, headSha }`.
- `logs skip reason when CI is not green` — assert logger.debug with `'Skipping post-completion review: CI not all passing'`.
- `logs skip reason when already dispatched` — assert logger.info with `'Skipping post-completion review: already dispatched'`.

**Implementation** (`src/triggers/shared/agent-execution.ts`):
- Add structured log calls at each decision point inside `tryDispatchPostCompletionReview`.

---

## Test Plan

### Unit tests
- [ ] `tests/unit/triggers/shared/agent-execution.test.ts`: ~8 new tests covering the post-completion hook (fire conditions, skip conditions, dedup, error handling).

### Acceptance tests
- [ ] Implementation success + green CI → review dispatched.
- [ ] Implementation success + CI not green → no review dispatched (webhook will handle later).
- [ ] Hook fires → subsequent webhook deduped.
- [ ] Hook failure → implementation pipeline completes normally.

---

## Acceptance Criteria (per-plan, testable)

1. When `agentType = 'implementation'`, `agentResult.success = true`, `agentResult.prUrl` is set, and `getCheckSuiteStatus` returns `allPassing: true`, the review agent is dispatched from the post-completion hook.
2. When `agentType` is not `'implementation'`, no review dispatch fires from the hook.
3. When CI is not all-passing, no review dispatch fires (deferred to `check-suite-success` webhook).
4. When `claimReviewDispatch` returns false (review already dispatched), no second review enqueues.
5. When the hook throws (GitHub API down, Redis error), the implementation pipeline completes normally — error is logged as warn.
6. The hook's dispatch uses the same dedup key format as `check-suite-success`, so the two cannot double-enqueue.
7. All new/modified code has corresponding tests.
8. `npm test` passes.
9. `npm run typecheck` passes.
10. `npm run lint` passes.
11. `CLAUDE.md` updated to document the post-completion review dispatch under "Agent triggers".

---

## Documentation Impact (this plan only)

| File | Change |
|---|---|
| `CLAUDE.md` | Add a note under "Agent triggers" describing the post-completion review dispatch: when an implementation agent succeeds with a PR, the execution pipeline checks CI status and fires review before the container exits. Note the dedup interaction with `check-suite-success`. |

---

## Out of Scope (this plan)

- Generalizing the post-completion hook to other trigger chains (splitting → planning, etc.) — per spec, only implementation → review is specified.
- `pr-opened` trigger enablement — per-project config decision.
- Lock persistence to Redis/DB — out of spec scope.
- Making the hook work without `REDIS_URL` in the worker container — all CASCADE worker containers have Redis access.

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
