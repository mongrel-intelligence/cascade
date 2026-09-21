# Router, triggers and dispatch

**Applies to:** `src/router/**`, `src/triggers/**`, `src/webhook/**`, `src/queue/**`

Mechanism lives in [02-webhook-pipeline](../architecture/02-webhook-pipeline.md), [03-trigger-system](../architecture/03-trigger-system.md), [10-resilience](../architecture/10-resilience.md) and [`src/triggers/README.md`](../../src/triggers/README.md). Below are the rules that are easy to break from inside this area.

## Locks and dispatch

- The work-item lock is per `(projectId, workItemId, agentType)` with a 30-minute TTL; different agent types may run concurrently on one work item → 10-resilience § Concurrency Controls.
- Any path that marks a lock must register its compensation: post-enqueue failures release through `worker.on('failed')` → `releaseLocksForFailedJob`; enqueue failures must not mark a lock at all. `wedged_lock_canary` in Sentry means a path broke this → 10-resilience § Dispatch retries, § Wedged-lock canary.
- Classify new dispatch errors in `src/router/dispatch-error-classifier.ts`: transient errors propagate so BullMQ retries; terminal ones are wrapped in `UnrecoverableError`. A capacity miss waits for a slot — it never throws → 10-resilience § Dispatch retries.
- PM router adapters wrap `triggerRegistry.dispatch` in `withPMScopeForDispatch` → [pm-integrations](./pm-integrations.md).

## Triggers

- Return `deferredRecheck` only from GitHub handlers — bare re-dispatch is GitHub-only; PM and Sentry adapters embed the pre-resolved `triggerResult` and would replay it → 10-resilience § Deferred re-check exhaustion.
- Review dispatch after a successful implementation and the `check-suite-success` trigger share the `claimReviewDispatch` dedup key — use it on any new review-dispatch path → 03-trigger-system § Shared Agent Execution.
- The implementation freshness gate runs only for `agentType === 'implementation'`; do not extend it to follow-up agents → 03-trigger-system § Shared Agent Execution.
- Every SCM handler filters self-events with `isCascadeBot(login)`; the self-directed `review_requested` exemption is the only exception → 10-resilience § Loop Prevention.
- Use the canonical `TRIGGER_EVENTS` constants and the shared result builders; new PM events go through `processPMWebhook()` → `src/triggers/README.md`.
- PM status-change webhooks coalesce for `PM_COALESCE_WINDOW_MS`; the ack comment is deferred to job fire time → 02-webhook-pipeline.

## Worker lifecycle

- Keep `formatCrashReason` output (`src/router/active-workers.ts`) grep-stable — `tests/unit/router/container-manager-diagnostics.test.ts` pins it; `OOMKilled=true` is the only memory signal → 10-resilience § Orphan Cleanup.
- PR checkout is by `refs/pull/<N>/head`, never by branch name; a non-zero git exit is fatal → [01-services § Repository checkout](../architecture/01-services.md).
