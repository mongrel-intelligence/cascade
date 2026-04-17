---
id: 007
slug: robust-review-dispatch
level: spec
title: Robust review dispatch after implementation completes
created: 2026-04-17
status: draft
---

# 007: Robust review dispatch after implementation completes

## Problem & Motivation

When an implementation agent finishes and the PR's CI goes green, the `check-suite-success` trigger fires the review agent. On 2026-04-16 (MNG-122 / PR #572 on llmist), the review was **silently dropped** — the trigger matched twice, both times hitting `Skipping github job — work item already locked`, and the review was never enqueued. The user saw a PR sitting with zero reviews for hours until they noticed manually.

Three intersecting failures combined to produce the silent drop:

1. **Lock release lags agent completion by 60+ seconds.** The work-item lock is released when the worker *container* exits, not when the agent finishes. Between the two: snapshot commit, log collection, container teardown — all blocking the lock while GitHub webhooks arrive and are discarded. On MNG-122, the `agent_runs` row was marked `completed` at 05:29:13 but the lock was still held at 05:30:15 and 05:31:59.

2. **Blocked webhooks are silently discarded.** When `isWorkItemLocked` returns true, the router logs `Skipping github job` and drops the event with no retry mechanism. GitHub does not redeliver `check_suite` webhooks, so the review opportunity is permanently lost.

3. **Lock doesn't distinguish agent types.** The lock key is `(projectId, workItemId)` — an implementation lock blocks review dispatch even though the two agents don't compete for the same resource. An implementation run holding a lock has no reason to prevent a review from being queued.

The `pr-opened` trigger for review is intentionally disabled on llmist (project config) — `check-suite-success` was the sole path to review, making it a single point of failure when the lock blocked it.

This is not a rare edge case. The implementation → PR-open → CI-green → review chain fires on every Linear-backed implementation run, and the timing window (container exit lags agent completion by 30-120s depending on snapshot size) overlaps the CI completion window on most repos with 2-3 minute CI jobs. The review will be silently dropped whenever CI finishes before the container fully exits.

---

## Goals

- Reviews are always dispatched after an implementation PR passes CI, regardless of lock timing
- The work-item lock accurately reflects what is actually competing — different agent types on the same work item are not competitors
- Lock release happens at the natural "work is done" boundary (DB completion), not at the infrastructure cleanup boundary (container exit)
- A post-completion hook on the implementation agent ensures review fires deterministically, without relying on webhook timing

---

## Non-goals

- Changing GitHub webhook retry behaviour (GitHub controls redelivery)
- Enabling `pr-opened` for review on llmist or other projects — that's a per-project config decision, not an architectural fix
- Making the work-item lock persistent across router restarts (the in-memory lock with TTL is fit for purpose once the timing and granularity issues are fixed)
- Generalizing the post-completion hook to all trigger types — only the implementation→review chain needs it today; other chains can be added incrementally

---

## Constraints

- The fix must not break existing Trello/JIRA projects that rely on the coarse lock to prevent duplicate implementation runs on the same card
- Container cleanup (snapshot commit, log collection) must still happen after agent completion — it just must not block the lock
- The BullMQ job queue must remain the sole execution path — no second queue, no cron, no polling loop
- Router restarts must not leave stale locks that block review indefinitely (the existing 30-min TTL is acceptable as a hard ceiling)

---

## User stories / Requirements

1. **As an operator**, when an implementation agent completes and CI goes green, I see a review agent dispatched within 30 seconds — regardless of how long the worker container takes to shut down.
2. **As an operator**, when I look at the router logs for a stuck PR, I can see exactly why the review was or wasn't dispatched — no silent drops with only a `Skipping` log at DEBUG level.
3. **As a developer adding a 4th PM provider**, the lock and dispatch behaviour works identically for Trello, JIRA, Linear, and the new provider — no per-provider special cases in the lock logic.
4. **As an operator**, if the post-completion hook somehow fails to fire the review, the next `check-suite-success` webhook (e.g. from a late-completing CI workflow) can still dispatch the review — the lock is no longer blocking it.

---

## Research Notes

- Internal investigation only — no external OSS or academic research is applicable. The problem is specific to CASCADE's in-memory work-item lock, container lifecycle, and webhook processing pipeline.
- The lock was introduced to prevent duplicate agent runs when rapid-fire webhooks (e.g. multiple `check_suite` events for the same PR) enqueue the same agent type multiple times. That invariant must be preserved.
- BullMQ supports delayed jobs natively, but the chosen approach (post-completion hook) is simpler and doesn't introduce timing sensitivity.

---

## Open Source Decisions

| Tool | Solves | Decision | Reason |
|------|--------|----------|--------|
| BullMQ delayed jobs | Retry after lock | Skip | Post-completion hook is simpler and deterministic; delayed jobs add timing guesswork |

---

## Strategic decisions

1. **Per-agent-type locking** — chose `(projectId, workItemId, agentType)` as the lock key over the current `(projectId, workItemId)`. Reason: implementation and review don't compete for the same resource; the coarse lock was a false serialization. The duplicate-prevention invariant (same agent type doesn't double-enqueue) is preserved because the lock still holds per-type.

2. **Lock release at DB completion, not container exit** — chose to release the in-memory lock when `agent_runs.status` transitions to a terminal state (`completed`/`failed`/`timed_out`) over keeping it tied to container exit. Reason: closes the 60s+ gap where the lock falsely blocks new dispatch. Container cleanup (snapshot commit, log collection) continues in the background without holding the lock — those operations don't affect the work item's state.

3. **Post-completion hook fires review** — chose a synchronous post-completion step in the implementation agent's lifecycle (after success, before container cleanup) that checks "does this work item have an open PR with green CI and no review dispatched yet?" and, if so, enqueues the review directly. Chose this over BullMQ delayed retry because it's deterministic (no timing guesswork), simpler (no new queue patterns), and fires regardless of whether a GitHub webhook arrived while the lock was held.

4. **Log level for lock-skip raised to INFO with structured context** — the current `Skipping github job` log is at INFO but lacks enough context to diagnose which webhook was dropped and why. The spec requires the log to include: projectId, workItemId, agentType, the trigger handler name, and the lock holder's agent type. This turns the silent drop into a diagnosable event even when the post-completion hook rescues the dispatch.

---

## Acceptance Criteria (outcome-level)

1. When an implementation agent completes and the corresponding PR has green CI, the review agent is dispatched within 30 seconds — regardless of container exit timing.
2. The review agent can be dispatched while the implementation agent's container is still shutting down (snapshot commit, log collection in progress).
3. Two different agent types for the same work item can run concurrently (e.g. review starts while implementation's container cleanup is finishing).
4. Two runs of the SAME agent type for the same work item are still prevented by the lock (duplicate-prevention invariant preserved).
5. If the post-completion hook fires the review, a subsequent `check-suite-success` webhook does not double-enqueue a second review (deduplication still works).
6. Router logs show structured context when a webhook is blocked by a lock: projectId, workItemId, blocked agent type, lock holder agent type, trigger handler name.
7. The fix works identically for Trello, JIRA, and Linear projects — no per-provider branching in the lock or dispatch logic.
8. Router restart does not leave stale locks that permanently block review dispatch. (Existing 30-min TTL hard ceiling is acceptable.)

---

## Documentation Impact (high-level)

- `CLAUDE.md` — Update the "Agent triggers" section to note the post-completion review dispatch and per-agent-type locking.
- Integration README — No change needed (PM integration doc doesn't cover lock behaviour).

---

## Out of Scope

- Enabling `pr-opened` for review on llmist or other projects — that's a per-project operator decision.
- Persisting the work-item lock to Redis or DB — the in-memory lock with TTL is sufficient for the router's single-process deployment model.
- Generalizing the post-completion hook to all trigger chains (e.g. splitting → planning). Only implementation → review is specified. Other chains can be added incrementally.
- Refactoring the orphan-cleanup scan to also clear stale in-memory locks — the per-agent-type locking + DB-completion-release makes this unnecessary for the review use case. If a separate need arises, spec it separately.
- Making the lock distributed across multiple router instances — CASCADE runs a single router process per deployment.
