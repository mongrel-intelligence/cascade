---
id: 015
slug: router-job-dispatch-failure-recovery
level: spec
title: Router job dispatch failure recovery
created: 2026-04-26
status: draft
---

# 015: Router job dispatch failure recovery

## Problem & Motivation

CASCADE's router has a silent black-hole failure mode. When a webhook-driven job is pulled off the queue and the dispatcher cannot immediately spawn a worker — because every worker slot is already occupied by a prior run, or because the Docker daemon hiccups, or because an image-pull rate-limit fires — the dispatcher throws synchronously. With the queue's current "attempts: 1, no retry" defaults, that single throw moves the job straight to the failed set in Redis. It is never picked up again, even after capacity frees up seconds later. The user gets no error in the UI; the agent never runs; the work item appears to have been silently ignored.

The damage doesn't stop at one lost job. The webhook handler establishes in-memory bookkeeping — a same-type-per-work-item concurrency lock, an agent-type concurrency counter, and a recently-dispatched dedup mark — *between* the moment it puts the job on the queue and the moment a worker container actually starts. The lock-release logic only fires from the worker-exit path, which itself only runs when a worker container was actually started. A spawn-time throw never reaches that path, so all three lock entries leak. The work-item lock in particular has a 30-minute TTL and only auto-clears on router restart. For 30 minutes after a transient capacity miss, every subsequent webhook for that work item + agent type is silently rejected with the misleading reason `"Work item locked: 1 enqueued (max 1 per type)"`. The user, seeing no agent run after dragging a card to Todo, drags it again — and again — with no feedback that the lock is wedged.

This was hit in production on 2026-04-26 against the ucho project (Linear card MNG-350). A user moved the card to Todo at 15:29:07 UTC. The job was enqueued and pulled by BullMQ; the only worker slot was held by an unrelated MNG-354 implementation that had spawned ~2 seconds earlier. The MNG-350 dispatcher threw "No worker slots available" and the job was failed. The user re-moved the card to Backlog→Todo three more times across the next 18 minutes — every webhook returned the misleading "locked" decision. The card sat dead until a manual CLI trigger force-dispatched through a separate path that bypasses the lock. This is a credibility-class incident for an automation product whose entire value proposition is "PM card moves automatically translate into agent runs." Unattended workflows must not silently break.

The fix needs three contract changes that work in concert: (1) transient dispatch failures must retry, with bounded attempts and backoff so a real outage isn't masked, (2) any in-memory lock state acquired at enqueue time must be released the moment dispatch fails, before any subsequent webhook can be misled by it, and (3) the webhook decision-reason taxonomy must let users (and operators reading webhook logs) distinguish a healthy in-flight run from a wedged lock that needs intervention.

---

## Goals

1. A transient over-capacity condition during dispatch never causes a job to be permanently lost. The job either backpressures naturally until a slot is available, or is retried with bounded attempts and is only declared dead after the bound is exhausted.
2. A transient Docker-side spawn error (daemon unreachable, image-pull rate-limit, container-name race) is retried within a bounded attempt budget. A terminal error (e.g. validation failure, missing credentials, a fallback image that genuinely doesn't exist) fails fast without burning the retry budget.
3. Every in-memory lock entry acquired during the webhook → enqueue path is released when the dispatch ultimately fails, before the next webhook for the same work item arrives. No 30-minute wedge is possible regardless of which exception path the dispatcher took.
4. Webhook decision logs distinguish healthy in-flight state ("queued, awaiting slot") from wedged-lock state ("lock count says enqueued but no active dispatch can be found"). Users moving a card see decision reasons that describe what is actually happening.
5. Both the webhook-driven job queue and the dashboard manual-run queue benefit from the same retry symmetry. The work-item lock bypass on manual-run remains untouched (intentional escape hatch), but neither queue should permanently lose a job to a single transient dispatch failure.
6. Existing healthy paths (successful spawn, successful exit, manual-run, snapshot fallback, agent-type concurrency limits) continue to behave identically. The fix is failure-path symmetry, not a redesign of dispatch.

---

## Non-goals

- Redesigning worker-pool sizing or how `maxWorkers` is computed.
- Overhauling the BullMQ concurrency model or moving off BullMQ.
- Changing the work-item-lock semantics (one same-type agent per work item per project remains the rule, per spec 007).
- Modifying the snapshot reuse / fallback-to-base-image logic.
- Changing the dashboard manual-run lock-bypass behavior — manual runs are the user's escape hatch and stay that way.
- Building a UI surface for failed-set inspection. Webhook log decision reasons are the user-facing surface for now.
- Backfilling a re-dispatch sweep at router startup that picks up jobs already dead in the failed set (operational cleanup; out of scope for the contract change).

---

## Constraints

- The fix must not introduce new race windows. The point at which lock state is acquired and the point at which it is released must remain consistent across all dispatch outcomes (success, transient failure with eventual retry success, transient failure exhausting retries, terminal failure).
- Retry budgets must be small enough that a true Docker outage is surfaced within minutes, not hours. A transient blip should be invisible; a sustained outage should still page someone through Sentry within a few minutes.
- The dispatcher must not block forever waiting for a worker slot if the system is genuinely stuck. Any wait-for-slot mechanism needs a timeout that surfaces a Sentry-visible error, not a silent hang.
- Job-data carried into the retry path must remain identical across attempts. A retry must dispatch the same work item, same agent type, same ack info — not a re-derived version that could disagree with what the first attempt registered locks for.
- The change is restricted to the router's dispatch surface. Trigger-handler logic, agent input building, and the worker container's runtime contract are unchanged.

---

## User stories / Requirements

1. **As a CASCADE user**, when I move a Linear/Trello/JIRA card to a state that triggers an agent, the agent run starts even if the worker pool is briefly at capacity. I never have to drag the card a second time to "wake the system up."
2. **As a CASCADE user**, when something is genuinely wrong with the worker fleet (Docker down, host out of memory), I get a clear failure signal — either an ack comment that the run failed or an error visible in the dashboard — rather than a silently dropped job.
3. **As an operator reading webhook logs during an incident**, I can tell the difference between "this work item has 1 active run in progress, the new webhook was correctly deduped" and "this work item's lock count is non-zero but nothing is actually running — the lock is wedged."
4. **As a router process**, when I throw during dispatch, I leave no in-memory lock entry behind that could mislead a future webhook for the same work item + agent type.
5. **As a router process**, when a transient dispatch failure resolves on retry, the job runs to completion exactly once. The lock state at run-start matches the lock state at run-end.
6. **As a router process restarting after a crash**, I do not strand work-item locks across the restart. (Already true today via in-memory locks living only in process memory; this spec must not regress that.)

---

## Research Notes

- BullMQ's worker model treats `processFn` rejection as "job failed" and consults the job's `attempts` and `backoff` options to decide whether to retry. With `attempts: 1` and no backoff, any rejection moves the job to the failed set permanently. ([BullMQ docs — Retrying failing jobs](https://docs.bullmq.io/guide/retrying-failing-jobs))
- BullMQ exposes a `worker.on('failed', ...)` event that fires after a job's final retry exhaustion. This is the natural seam for compensating in-memory state established outside BullMQ's transactional view (locks, dedup marks). The event receives the job and the error, sufficient to identify what to release.
- Semaphore-style backpressure (P-Queue, Throat, Bottleneck) is the standard pattern for "wait-for-slot" semantics that integrate cleanly with async functions. The trade-off vs throw-and-retry is fewer failed-set entries at the cost of holding more open async tasks. For our use case (≤10 concurrent slots, sub-second wait granularity, retry attempts cost a Redis round-trip each), wait-for-slot is the cleaner fit.
- BullMQ's `concurrency` setting controls how many `processFn` invocations are in flight, not how many "work items" are running. Because our `processFn` resolves on container *start*, not container *exit*, BullMQ's concurrency does not function as a worker-pool cap. This is the root cause of the throw-on-capacity pattern existing in the first place: someone's safety net for a mismatch the queue isn't aware of. The spec restores correctness by closing that mismatch on the dispatch side.
- "Compensating actions" (release locks on dispatch failure) is a long-standing pattern in transaction processing — see Garcia-Molina & Salem's "Sagas" (1987). The applicable rule: every action that acquires durable state outside the local transaction must register a compensator that runs on rollback. In our case, the rollback trigger is the BullMQ failed event.

---

## Open Source Decisions

| Tool | Solves | Decision | Reason |
|------|--------|----------|--------|
| [BullMQ retry/backoff](https://docs.bullmq.io/guide/retrying-failing-jobs) | Bounded retry of transient dispatch failures | **Use** | Already in use; configuring `attempts` + `backoff` on the existing queue is the smallest possible change for the retry contract. |
| [BullMQ Worker `failed` event](https://docs.bullmq.io/guide/events) | Cleanup hook for in-memory lock state on dispatch failure | **Use** | The only reliable place to compensate state for *any* dispatch-path exception, including ones that don't exist yet. Already wired for logging — we extend the existing handler. |
| Semaphore library (e.g. [async-sema](https://github.com/vercel/async-sema), [p-limit](https://github.com/sindresorhus/p-limit)) | Wait-for-slot backpressure inside the dispatch processFn | **Skip (default), revisit during /plan** | A small in-house counter with a queue of resolvers is sufficient and has zero new deps. Plan can reverse this if it finds a real reason to adopt a library. |

---

## Strategic decisions

1. **Capacity miss is handled by wait-for-slot, not throw-and-retry.** The dispatcher awaits a slot up to a bounded timeout instead of throwing. Reason: eliminates the failed-set churn for capacity entirely, leaving retries reserved for genuine Docker errors. If the wait-for-slot timeout itself trips, it surfaces as a real error (Sentry-visible) and a single retry attempt — not silent loss.
2. **Retries are reserved for transient Docker-side errors.** A small bounded retry budget with exponential backoff applies to Docker daemon unreachable, image-pull rate-limit, and container-name collision races. Terminal errors (validation, missing credentials, fallback image not found) fail fast on the first attempt. The classifier lives at the boundary of the dispatcher; the spec defines the dichotomy, the plan picks the implementation.
3. **Lock compensation runs from the queue's failed event.** Cleanup hooks attached to the BullMQ failed event read the original job's `(projectId, workItemId, agentType)` payload and release every lock entry that the enqueue path established. This catches every dispatch-path exception, including paths that don't exist today. We do not rely on per-throw try/finally inside individual dispatch functions — that approach is fragile and depends on each new code path remembering to compensate.
4. **Webhook decision reasons are split into three states.** "Job queued" (success), "Awaiting worker slot" (queued behind N active runs, healthy), and "Work item locked (no active dispatch)" (wedged-lock state, requires correlating in-memory lock count with active worker registry + BullMQ queue state). The third reason exists specifically as a diagnostic for operators and as a safety net to confirm the compensation path is working — if it ever fires after this spec ships, that's a regression.
5. **Both queues get the retry treatment; only one keeps the lock-release path.** The dashboard manual-run queue and the webhook job queue both get the retry-on-transient-failure contract. The manual-run path's existing lock-bypass behavior is preserved unchanged — manual runs are the user's escape hatch when something else is wedged.
6. **The currently-stuck job in production is operational cleanup, not in scope.** The dead `linear-1777217350854-2qvhjo` job in the failed set is removed by hand. This spec ensures *future* failures don't strand jobs; an automatic startup sweep that re-enqueues failed-set entries is a deliberate non-goal — surfacing those errors loudly is more valuable than silently re-attempting them.

---

## Acceptance Criteria (outcome-level)

1. A user moves a PM card to a triggering state while the worker pool is at capacity. The agent run starts when capacity frees, with no further user action. The same flow does not produce a permanently failed job in BullMQ.
2. A user moves a PM card to a triggering state while the Docker daemon is briefly unreachable (e.g. socket reconnects within a few seconds). The agent run starts on retry. The same flow does not produce a permanently failed job in BullMQ.
3. A user moves a PM card to a triggering state while Docker is genuinely down (sustained outage exceeding the retry budget). The webhook is acknowledged, the run is marked failed in the dashboard, and a Sentry error is captured. No silent loss.
4. After any dispatch failure path — capacity-wait timeout, transient retry exhaustion, terminal error — a webhook for the same work item + agent type that arrives immediately afterward is **not** rejected with a "locked" decision reason caused by a stranded in-memory lock. The lock state matches the actual worker registry state.
5. While a worker is actively dispatching or running for a work item, a duplicate webhook for the same work item + agent type is rejected with a decision reason that distinguishes "in-flight, healthy" from "wedged lock." An operator inspecting webhook logs can tell which is which without reading source.
6. The wedged-lock decision reason never fires under normal operation. Its presence in webhook logs is itself a signal that compensation has missed a path — i.e. it is intended as a diagnostic invariant, not a routine state.
7. The dashboard manual-run path continues to bypass the work-item lock and continues to dispatch successfully even when the lock count for that work item + agent type is non-zero.
8. A worker container that successfully dispatches and exits cleanly behaves identically to today: locks released on exit, snapshot committed (where applicable), run record in the dashboard.
9. Existing test coverage for the worker-manager dispatch path is updated to reflect the new contract (specifically, the assertion that "processFn throws when at capacity" is replaced with the new wait-for-slot contract). No test silently passes that previously failed.

---

## Documentation Impact (high-level)

- `CLAUDE.md` — the project root entry already documents the work-item concurrency lock and the worker exit diagnostics; needs an updated paragraph capturing the new dispatch retry contract and the three-way webhook decision-reason taxonomy. This is load-bearing cross-cutting behavior with no other natural home and is exactly the kind of invariant that decays in CLAUDE.md if not updated alongside the change.
- `CHANGELOG.md` — entry under the next release noting the silent black-hole fix and the new decision-reason vocabulary.

---

## Out of Scope

- Worker-pool sizing or `maxWorkers` autoscaling.
- BullMQ → another queue migration.
- Work-item-lock semantics (one same-type agent per work item, per spec 007).
- Snapshot reuse and snapshot-image fallback logic.
- Manual-run lock-bypass behavior (intentional, stays).
- Failed-set inspection UI in the dashboard.
- Startup sweep that re-enqueues already-failed jobs from the failed set.
- Cleanup of the existing dead `linear-1777217350854-2qvhjo` entry — operational, handled out-of-band.
- Cross-router-instance lock coordination (locks remain in-process; spec 007 lock semantics already handle this via DB fallback).
