---
id: 015
slug: router-job-dispatch-failure-recovery
plan: 1
plan_slug: failed-event-lock-compensation
level: plan
parent_spec: docs/specs/015-router-job-dispatch-failure-recovery.md
depends_on: []
status: pending
---

# 015/1: Failed-event lock compensation + decision-reason taxonomy

> Part 1 of 2 in the 015-router-job-dispatch-failure-recovery plan. See [parent spec](../../specs/015-router-job-dispatch-failure-recovery.md).

## Summary

This plan closes the **stranded-lock** half of the spec's bug class. It hooks BullMQ's existing `worker.on('failed')` event on both queues to release every in-memory lock entry that the webhook → enqueue path acquires (work-item lock, agent-type lock, recently-dispatched dedup mark) when dispatch ultimately fails. After this plan ships, no dispatch failure — capacity throw, Docker spawn error, or any future throw site — can leave a wedged lock that mis-rejects subsequent webhooks for the same work item.

It also splits the webhook decision-reason vocabulary that Step 8's lock check emits into three distinguishable states: **Job queued** (success path, unchanged wording aside from existing `Job queued: ...`), **Awaiting worker slot** (lock held *and* a corresponding active worker / queued job is reachable — the healthy in-flight case), and **Work item locked (no active dispatch)** (lock held but no active worker and no waiting job — the wedged-lock canary). The third reason is a regression invariant: after this plan ships, its presence in webhook logs means a code path acquired a lock without registering its compensation — which the plan's tests prevent.

This plan does NOT change the dispatch contract — `guardedSpawn` still throws on capacity, `attempts: 1` is still set, jobs still die in the failed set after one bad dispatch. The user-visible improvement is "no more wedged locks" — half the original incident is gone. The other half (lost jobs) is delivered by Plan 2.

**Components delivered:**
- New compensator that maps `(jobData) → (projectId, workItemId, agentType)` and releases all three locks. Lives in a new module under `src/router/`.
- `worker.on('failed')` handler in `src/router/bullmq-workers.ts` extended to invoke the compensator for both `cascade-jobs` and `cascade-dashboard-jobs` queues.
- `src/router/webhook-processor.ts` Step 8 (work-item lock check) emits one of three decision reasons by correlating the lock count with the active-worker registry + the BullMQ queue's waiting/active counts.
- New tests: failed-event compensator releases locks for each lock kind across both queues; decision-reason taxonomy covers all three states.

**Deferred to later plans in this spec:**
- Wait-for-slot replacement of the capacity throw — Plan 2.
- `attempts > 1` + retry classifier — Plan 2.
- CLAUDE.md update covering both halves of the new contract — Plan 2.
- Replacement of the existing `'processFn throws when at capacity'` test — Plan 2 (this plan adds new tests around the failed-event hook; the throw-on-capacity test stays green here because the throw still happens).

---

## Spec ACs satisfied by this plan

- Spec AC #4 (no stranded lock after any dispatch failure path) — **full**
- Spec AC #5 (decision reason distinguishes in-flight from wedged-lock) — **full**
- Spec AC #6 (wedged-lock canary never fires under normal operation) — **full**
- Spec AC #7 (manual-run path continues to bypass the lock and dispatch successfully) — **full** (regression test pinning the existing bypass)
- Spec AC #8 (clean-exit path identical to today) — **full** (regression test pinning the existing exit path)
- Spec AC #9 (test coverage updated) — **partial** (adds new failed-event tests; old throw-on-capacity test is replaced by Plan 2)

---

## Depends On

None. This plan is a strict additive layer on existing dispatch paths. It can ship independently of Plan 2.

---

## Detailed Task List (TDD)

### 1. Lock compensator module

**Tests first** (`tests/unit/router/dispatch-compensator.test.ts`):

- `releaseLocksForFailedJob — releases work-item, agent-type, and recently-dispatched marks for a CascadeJob with all three identifiers` — unit — call compensator with `{ type: 'linear', projectId: 'p1', workItemId: 'w1', /* …enough payload that extractAgentType returns 'implementation' */ }`; assert all three lock-module spies were called with `('p1', 'w1', 'implementation')` (or `('p1', 'implementation')` for agent-type / recently-dispatched). Expected red: `Error: Cannot find module './dispatch-compensator'`.
- `releaseLocksForFailedJob — no-ops cleanly when projectId is null` — unit — pass a job whose `extractProjectIdFromJob` resolves to `null` (e.g. a foreign-provider payload); assert no lock-module spies were called and the function resolved without throw. Expected red: same module-not-found error first; after creating the module with a stub that always calls clearWorkItemEnqueued, this test fails with `expect(mockClearWorkItemEnqueued).not.toHaveBeenCalled()`.
- `releaseLocksForFailedJob — releases agent-type-lock + recently-dispatched even when workItemId is undefined` — unit — pass a manual-run job that has `projectId` and `agentType` but no `workItemId`; assert work-item-lock spy was NOT called, agent-type-lock and recently-dispatched spies WERE called. Expected red: as above; or `expect(mockClearWorkItemEnqueued).not.toHaveBeenCalled()` if the implementation calls it unconditionally.
- `releaseLocksForFailedJob — handles a DashboardJob (manual-run) without throwing` — unit — pass `{ type: 'manual-run', projectId, workItemId, agentType }`; assert spies as appropriate. Expected red: type narrowing failure or `extractAgentType` returning undefined.
- `releaseLocksForFailedJob — captureException when an extractor throws` — unit — mock `extractProjectIdFromJob` to throw; assert `captureException` is called and the function still resolves (does not propagate). Expected red: unhandled rejection from the mocked extractor.

**Implementation** (`src/router/dispatch-compensator.ts`):
- Export `async function releaseLocksForFailedJob(jobData: CascadeJob | DashboardJobData): Promise<void>`.
- Resolve the trio via existing extractors imported from `src/router/worker-env.ts`: `extractProjectIdFromJob`, `extractWorkItemId`, `extractAgentType`.
- Call `clearWorkItemEnqueued(projectId, workItemId, agentType)` only when all three are defined.
- Call `clearAgentTypeEnqueued(projectId, agentType)` whenever `projectId && agentType`.
- Call `clearRecentlyDispatched(projectId, agentType, workItemId)` whenever `projectId && agentType` (we'll add this exported helper to `agent-type-lock.ts` — see section 2).
- Wrap each call in a try/catch that funnels to `captureException` with `tags: { source: 'dispatch_compensator' }` and a structured log; never propagate so a compensator failure doesn't crash the BullMQ worker.

### 2. New `clearRecentlyDispatched` exported helper

**Tests first** (`tests/unit/router/agent-type-lock.test.ts` — extend existing file):

- `clearRecentlyDispatched — removes the dedup entry for a (projectId, agentType, dedupScope) key set by markRecentlyDispatched` — unit — call `markRecentlyDispatched('p1', 'implementation', 'w1')`; assert `wasRecentlyDispatched('p1', 'implementation', 'w1')` returns `true`; call new `clearRecentlyDispatched('p1', 'implementation', 'w1')`; assert `wasRecentlyDispatched(...)` returns `false`. Expected red: `clearRecentlyDispatched is not a function`.
- `clearRecentlyDispatched — no-op when key was not previously marked` — unit — call clear without prior mark; assert no throw. Expected red: same as above.
- `clearRecentlyDispatched — leaves entries for other (agentType, scope) keys untouched` — unit — set marks for two distinct keys, clear one, assert the other still present. Expected red: same as above.

**Implementation** (`src/router/agent-type-lock.ts`):
- Export a new function `clearRecentlyDispatched(projectId, agentType, dedupScope?)` that deletes the corresponding key from `dedupMap`.
- Do NOT change the existing `markRecentlyDispatched` semantics or the `DEDUP_TTL_MS` value — this helper is purely additive, used only by the failed-event compensator.

### 3. Failed-event hook in BullMQ worker factory

**Tests first** (`tests/unit/router/bullmq-workers.test.ts` — extend existing file):

- `worker.on('failed') invokes releaseLocksForFailedJob with job.data` — unit — construct a Worker via `createQueueWorker` with a `processFn` that throws; emit `'failed'` synthetically (or invoke the registered handler directly); assert the compensator spy was called with the job data. Expected red: spy not called (existing `worker.on('failed')` only logs + Sentries today).
- `worker.on('failed') still logs and Sentries on top of compensating` — unit — assert both the existing log + `captureException` calls happen AND the compensator spy is invoked. Expected red: compensator spy not called.
- `worker.on('failed') swallows compensator throws` — unit — mock the compensator to reject; emit `'failed'`; assert the BullMQ worker factory does not propagate the rejection (no unhandled rejection in the test). Expected red: unhandled rejection, or factory under test crashes.
- `worker.on('failed') is wired for both cascade-jobs and cascade-dashboard-jobs queues` — unit — call `startWorkerProcessor()` with two distinct mock `createQueueWorker` returns; assert both registered a `failed` handler that calls the compensator. Expected red: only one handler wired (or none).

**Implementation** (`src/router/bullmq-workers.ts`):
- Inside `createQueueWorker`'s existing `worker.on('failed', ...)` handler, after the existing logger + `captureException` calls, invoke `releaseLocksForFailedJob(job.data)` if `job` is defined. Wrap in try/catch with `captureException` so a compensator throw does not poison the worker.

### 4. Three-way decision-reason taxonomy in webhook-processor

**Tests first** (`tests/unit/router/webhook-processor.test.ts` — extend existing file):

- `Step 8 — emits 'Awaiting worker slot' when lock count >= 1 AND at least one active worker is registered for (projectId, workItemId, agentType)` — unit — set up `enqueuedMap` to register one entry; mock `getActiveWorkers()` to include a matching worker; expect the returned `decisionReason` to start with `Awaiting worker slot:`. Expected red: today's reason starts with `Work item locked:`.
- `Step 8 — emits 'Awaiting worker slot' when lock count >= 1 AND a matching job is in BullMQ waiting/active state` — integration — push a real BullMQ job (mocked Redis or test connection) into the waiting state; set the in-memory lock; assert the decision reason. Expected red: today's reason as above.
- `Step 8 — emits 'Work item locked (no active dispatch)' when lock count >= 1 AND neither active worker nor queued job exists for the trio` — unit — set the lock entry but ensure both `getActiveWorkers()` returns an empty list and the queue's `getJobs(['waiting','active'])` returns an empty list. Expected red: today's reason wording.
- `Step 8 — preserves existing log fields (source, projectId, workItemId, blockedAgentType, reason)` — unit — capture the log call; assert all fields present. Expected red: log structure changed unintentionally.
- `Step 8 — does not call queue.getJobs when lock count is 0` — unit — assert no queue lookup happens on the happy path (no perf regression). Expected red: an unexpected queue call (which is a sign the implementation does the lookup unconditionally).

**Implementation** (`src/router/webhook-processor.ts` and a new helper):
- Add a helper, e.g. `classifyLockState({ projectId, workItemId, agentType }): Promise<'awaiting-slot' | 'wedged' | 'unknown'>`, in a new module `src/router/lock-state-classifier.ts` (or co-located helper file). The helper:
  - Returns `'awaiting-slot'` if `getActiveWorkers()` includes a worker whose `(projectId, workItemId, agentType)` matches OR `jobQueue.getJobs(['waiting','active'])` returns at least one matching job (matched by the same trio extracted via the existing extractors).
  - Returns `'wedged'` if the lock count is non-zero per the existing in-memory map and neither correlation matches.
  - Returns `'unknown'` only on classifier error (queue lookup throws); falls back to `'awaiting-slot'` for behavioral safety (do NOT mis-emit the wedged-lock canary on an error path).
- In `webhook-processor.ts:182-198`, when `lockStatus.locked` is true, call the classifier and pick one of:
  - `Awaiting worker slot: ${lockStatus.reason}` for `awaiting-slot` and `unknown`.
  - `Work item locked (no active dispatch): ${lockStatus.reason}` for `wedged`. **Also call `captureException` with a synthetic Error tagged `source: 'wedged_lock_canary'` and structured `extra` so the regression invariant is loud.**
- Keep the existing `result.onBlocked?.()` call path untouched.
- Augment `getActiveWorkers()` in `src/router/active-workers.ts` to return `projectId / workItemId / agentType` for each entry (currently returns only `{jobId, startedAt}`). Keep callers unchanged (extend the shape; don't break existing readers).

### 5. Active-workers shape extension

**Tests first** (`tests/unit/router/active-workers.test.ts` — extend existing file):

- `getActiveWorkers — returns projectId, workItemId, agentType for each tracked worker` — unit — register a worker via `activeWorkers.set` with all three identifiers; assert `getActiveWorkers()` includes them. Expected red: returned shape currently lacks the trio (only `jobId` + `startedAt` today).
- `getActiveWorkers — backwards-compatible callers (existing tests pinning jobId+startedAt) still pass` — unit — existing assertions on `jobId` and `startedAt` continue to pass. Expected red: only fails if the migration removes the old fields.

**Implementation** (`src/router/active-workers.ts`):
- Extend `getActiveWorkers()`'s return type to `Array<{ jobId: string; startedAt: Date; projectId?: string; workItemId?: string; agentType?: string }>`. Map from the existing `ActiveWorker` shape (the trio is already stored there per the spec context).

---

## Test Plan

### Unit tests
- [ ] `tests/unit/router/dispatch-compensator.test.ts`: 5 tests covering compensator behavior across job kinds + extractor-throw path
- [ ] `tests/unit/router/agent-type-lock.test.ts`: +3 tests for `clearRecentlyDispatched`
- [ ] `tests/unit/router/bullmq-workers.test.ts`: +4 tests for failed-event hook (logging + compensation + swallowing + both queues)
- [ ] `tests/unit/router/webhook-processor.test.ts`: +5 tests for the three-way decision-reason taxonomy
- [ ] `tests/unit/router/active-workers.test.ts`: +2 tests for the extended `getActiveWorkers` shape
- [ ] `tests/unit/router/lock-state-classifier.test.ts` (new): 4 tests covering `awaiting-slot` / `wedged` / `unknown` branches plus the fallback safety on classifier error

### Integration tests
- [ ] `tests/integration/router/dispatch-failure-compensation.test.ts` (new): exercises the real BullMQ in-memory + the real lock modules. Scenarios:
  - Enqueue a job whose processFn throws → assert all three locks are released by `worker.on('failed')` before the test resolves; assert a follow-up webhook for the same trio is NOT blocked.
  - Enqueue a job, let it succeed → assert locks are released by the existing exit path (regression test for AC #8).
  - Enqueue a manual-run job whose processFn throws → assert the manual-run lock-bypass (no work-item lock acquired in the first place) and that agent-type-lock + recently-dispatched are released.

### Acceptance tests
- [ ] AC #4: integration test "subsequent webhook not rejected after failed dispatch"
- [ ] AC #5: unit tests for the three decision-reason branches
- [ ] AC #6: wedged-lock branch emits the `wedged_lock_canary` Sentry tag — captured via spy
- [ ] AC #7: manual-run integration test pins the lock-bypass behavior
- [ ] AC #8: clean-exit integration test pins identical behavior
- [ ] AC #9 (partial): new tests added; existing throw-on-capacity test stays green (Plan 2 replaces it)

---

## Manual Verification (for `[manual]`-tagged ACs only)

n/a — all ACs auto-tested.

---

## Acceptance Criteria (per-plan, testable)

1. The failed-event compensator releases work-item-lock, agent-type-lock, and recently-dispatched marks for any job whose dispatch fails — for both `cascade-jobs` and `cascade-dashboard-jobs` queues.
2. A webhook for `(projectId, workItemId, agentType)` arriving immediately after a dispatch failure for the same trio is NOT rejected with a `Work item locked` decision reason caused by stranded in-memory state.
3. Webhook decision logs distinguish three states for a held lock: `Job queued` (success), `Awaiting worker slot: …` (in-flight, healthy), `Work item locked (no active dispatch): …` (wedged-lock canary). Each is emitted from the appropriate branch of the lock-state classifier.
4. The wedged-lock branch additionally fires a Sentry capture tagged `source: 'wedged_lock_canary'` so the invariant is observable in production.
5. The dashboard manual-run path continues to bypass the work-item lock and dispatch normally even when the lock count for the trio is non-zero.
6. A clean-exit successful run continues to release locks via the existing `cleanupWorker` path; no double-release race appears.
7. All new/modified code has corresponding tests written before the implementation.
8. `npm run build` passes.
9. `npm test` passes (unit projects).
10. `npm run test:integration` passes for the new integration test.
11. `npm run lint` passes.
12. `npm run typecheck` passes.
13. All documentation listed in this plan's Documentation Impact has been updated.

---

## Documentation Impact (this plan only)

| File | Change |
|---|---|
| `CHANGELOG.md` | Entry under the next release: "Router: dispatch failures now release in-memory work-item / agent-type / dedup locks via BullMQ failed-event compensation. Webhook decision reasons split into three states (Job queued / Awaiting worker slot / Work item locked — no active dispatch). The third reason is a regression canary." |

CLAUDE.md is intentionally NOT updated by this plan; Plan 2 ships the unified passage covering both halves of the new contract. Updating it twice would risk in-flight inconsistency.

---

## Out of Scope (this plan)

- Replacing `guardedSpawn`'s capacity throw with a wait-for-slot semaphore — Plan 2.
- Changing `attempts: 1` defaults on either queue or adding an exponential-backoff config — Plan 2.
- The dispatch-error classifier (`UnrecoverableError` vs transient retry-worthy) — Plan 2.
- Replacing the `'processFn throws when at capacity'` test in `tests/unit/router/worker-manager.test.ts` — Plan 2 (this plan leaves it green; it remains a true assertion of current behavior until Plan 2 changes the contract).
- CLAUDE.md update — Plan 2.
- A failed-set inspection UI — out of scope per spec.
- Cleanup of the dead `linear-1777217350854-2qvhjo` job in prod Redis — operational, out of scope per spec.

---

## Progress

<!-- /implement updates these as it works. Do not edit manually. -->
- [ ] AC #1 (compensator releases all 3 locks on both queues)
- [ ] AC #2 (subsequent webhook not blocked by stranded state)
- [ ] AC #3 (three decision-reason branches)
- [ ] AC #4 (wedged-lock Sentry canary)
- [ ] AC #5 (manual-run bypass regression)
- [ ] AC #6 (clean-exit regression)
- [ ] AC #7 (TDD discipline)
- [ ] AC #8 (build)
- [ ] AC #9 (unit tests)
- [ ] AC #10 (integration test)
- [ ] AC #11 (lint)
- [ ] AC #12 (typecheck)
- [ ] AC #13 (docs)
