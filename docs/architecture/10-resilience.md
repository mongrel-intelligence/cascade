# Resilience

CASCADE runs long-lived agent sessions (up to 30+ minutes) against external LLM APIs. The resilience layer ensures reliable operation through watchdog timers, concurrency controls, rate limiting, retry strategies, and loop prevention.

## Watchdog

`src/utils/lifecycle.ts`

Each worker container has a configurable watchdog timer that force-exits the process if the agent exceeds its timeout:

- **Timeout**: Configurable per project via `watchdogTimeoutMs` (default: 30 minutes)
- **Cleanup**: A cleanup callback is registered via `setWatchdogCleanup()` and called before force exit (with a 10-second cap)
- **Router-side buffer**: The router's worker manager adds a 2-minute buffer on top of the worker watchdog before considering a container orphaned

```typescript
startWatchdog(timeoutMs, () => {
  // cleanup callback: finalize run record, upload logs
});
```

## Concurrency Controls

### Work-item lock

`src/router/work-item-lock.ts`

Prevents multiple agents from working on the same card/issue simultaneously. The lock is in-memory (router process) with TTL expiry.

- Checked at webhook processing time (step 8 of the pipeline)
- Marked when a job is enqueued, cleared when the worker completes or when dispatch failure compensation runs
- Key: `(projectId, workItemId, agentType)`
- Only same-agent duplicates are blocked; different agent types may run concurrently on the same work item

### Agent-type concurrency limit

`src/router/agent-type-lock.ts`

Configurable `max_concurrency` per agent type per project (set via `agent_configs.max_concurrency`). Prevents too many instances of the same agent type running simultaneously.

- Tracks enqueued + running counts
- Blocks new jobs when limit reached
- Includes a "recently dispatched" window to prevent race conditions between enqueueing and worker startup

### Max in-flight items

`projects.max_in_flight_items` — project-level cap on total concurrent agent runs. Checked during trigger dispatch.

This gate is PM-provider scoped. PM router adapters enter `withPMScopeForDispatch(fullProject, dispatch)` before calling `TriggerRegistry.dispatch()` so shared trigger gates can call `getPMProvider()` and count active PM work items. If the scope is missing, the gate fails closed: it blocks dispatch, logs at error level, and captures to Sentry under `pipeline_capacity_gate_no_pm_provider`. This protects the PM-source path where `maxInFlightItems` matters most.

### BullMQ concurrency

The router's worker manager limits how many Docker containers run in parallel via `routerConfig.maxWorkers`.

When the pool is full, dispatch waits for a slot via `slot-waiter.ts` for `SLOT_WAIT_TIMEOUT_MS` (default 5 minutes). A timeout is classified as transient, so BullMQ retries it under the bounded queue retry policy.

## Rate Limiting

`src/config/rateLimits.ts`

Proactive, model-specific rate limits prevent hitting LLM provider quotas. Configured per model with safety margins (80-90% of actual limits):

- **RPM** (requests per minute)
- **TPM** (tokens per minute)
- **Daily token limit**

Rate limits are enforced by the LLMist SDK for `sdk`-archetype engines. Native-tool engines (Claude Code, Codex) handle rate limiting internally.

## Retry Strategy

### Friction report outbox

`ReportFriction` uses a JSONL sidecar as a small outbox so incidental agent issues do not block the main run. The gadget appends a queued event to `CASCADE_FRICTION_SIDECAR_PATH` before attempting PM materialization. Native-tool engines receive that path in their environment; in-process engines get the same value through session state.

On successful immediate materialization, the gadget appends a filed event with the PM work item ID/URL. If the immediate PM write fails, the gadget returns `queued_for_retry` and the agent should keep working unless the underlying issue is a real blocker.

The backend adapter drains pending sidecar events after the engine returns, including ordinary engine failures. Drain behavior is deliberately non-blocking:

- A missing `lists.friction` / `statuses.friction` slot produces a skipped report with reason `friction_slot_missing`; operators should configure the Friction row in the PM wizard's Status Mapping step.
- A PM API failure during drain logs a warning and captures Sentry with `source=friction_sidecar_drain_failed`, but it does not change a successful run into a failed run.
- After drain, the sidecar is compacted/cleaned so filed reports are not retried indefinitely.

### Dispatch retries

The router queues `cascade-jobs` and `cascade-dashboard-jobs` with `attempts: 4` and exponential backoff. Dispatch errors before a worker container starts are classified in `src/router/dispatch-error-classifier.ts`:

- Transient: Docker socket `ECONNREFUSED` / `ECONNRESET` / `ENOTFOUND`, registry HTTP 429, container-name HTTP 409, and `SLOT_WAIT_TIMEOUT`.
- Terminal: validation errors (`TypeError`, `ZodError`) and image-not-found after fallback exhaustion.

Post-enqueue dispatch failures (Docker socket errors, slot-wait timeouts, container failures) flow through the BullMQ `failed` event and call `releaseLocksForFailedJob`, releasing the work-item lock, agent-type counter, and recently-dispatched mark. Webhook logs distinguish healthy backpressure (`Awaiting worker slot`) from the wedged-lock canary (`Work item locked (no active dispatch)`). Enqueue/schedule failures that occur before a BullMQ job exists are handled differently — see the split below.

The compensation operates at two distinct boundaries — not a single unified path:

- **Enqueue/schedule failures** (`addJob` or `scheduleCoalescedJob` throws before any BullMQ job exists) — the router catches the error inline, calls `onBlocked()` to clear any pre-checked state, and returns a failure decision reason (`Failed to enqueue job to Redis` or `Failed to schedule coalesced job to Redis`). Lock protection here relies on the success-first ordering contract: `markImmediateDispatchEnqueued` and `markCoalescedDispatchEnqueued` are called only after a successful enqueue, so a Redis failure leaves no lock marked. There is no BullMQ job and therefore no `failed` event and no `releaseLocksForFailedJob` on this path. (Deferred re-check schedule failures are a special case: the router does not call `onBlocked` and still returns the scheduled decision reason; see the router outcomes table in `docs/architecture/02-webhook-pipeline.md`.)
- **Post-enqueue dispatch failures** (Docker socket errors, registry pull failures, container-name collisions, slot-wait timeouts) — a job already exists in BullMQ and locks are already marked. BullMQ retries under `attempts: 4` + exponential backoff. On exhaustion, `worker.on('failed')` calls `releaseLocksForFailedJob`, clearing the in-memory work-item lock, agent-type counter, and recently-dispatched dedup marker.

This split prevents both classes of failure from wedging a work item for the lock TTL: enqueue/schedule failures never mark a lock in the first place; post-enqueue failures eventually flow through `releaseLocksForFailedJob` compensation.

### Deferred re-check exhaustion

Some provider state is eventually consistent and has no follow-up webhook. A trigger can return `TriggerResult.deferredRecheck` with `agentType: null`; the router schedules a coalesced delayed bare job and does not take normal dispatch locks. The bare re-dispatch on job fire is currently **GitHub-only**: `GitHubRouterAdapter.buildJob()` strips `triggerResult` and sets `mergeabilityRecheckAttempt: 1`, so the GitHub worker re-dispatches through the registry to get fresh provider state. Non-GitHub adapters (Trello, JIRA, Linear, Sentry) embed `triggerResult` in the job; their workers return the pre-resolved `agentType: null` result directly without re-dispatching through the registry.

GitHub mergeability uses this for `pull_request` events where `mergeable === null`. If the deferred job still gets another deferred result, workers do not schedule a second re-check. The GitHub worker emits a WARN and captures to Sentry with tag `mergeability_recheck_exhausted`, making pathological provider latency visible without creating an infinite retry loop.

### Wedged-lock canary

The router classifies work-item lock rejections in `src/router/lock-state-classifier.ts`.

- `Awaiting worker slot: ...` is healthy backpressure: the lock correlates with queued, waiting, or running dispatch state.
- `Work item locked (no active dispatch): ...` is a canary: the classifier found a lock but no matching active dispatch. This captures to Sentry under `wedged_lock_canary`.

The canary should not appear during normal operation. Its presence means a path acquired a lock without completing registration or compensation.

### LLM/API retries

`src/config/retryConfig.ts`

Handles transient LLM API failures:

- **5 retry attempts** with exponential backoff (1s base, 60s max)
- **Jitter** randomization prevents thundering herd
- **Respects `Retry-After` headers** (capped at 2 minutes)
- **Custom detection** for undici/fetch stream termination errors
- **Logging** and Sentry breadcrumbs on each retry and exhaustion

Retries cover: HTTP 429 (rate limit), 5xx (server errors), timeouts, and connection failures.

## Context Compaction

`src/config/compactionConfig.ts`

Prevents context window overflow during long-running agent sessions:

- **Trigger**: 80% context usage
- **Target**: Reduce to 50%
- **Preserve**: 5 most recent turns
- **Strategy**: Hybrid summarization + sliding window
- Summarization preserves: task goals, key decisions, discovered facts, errors, and failed approaches (to avoid repeating them)
- Clears read-tracking state after compaction

## Iteration Hints

`src/config/hintConfig.ts`

Ephemeral trailing messages showing the agent its iteration budget:

- Displayed at configurable thresholds
- Urgency warnings at >80%: "ITERATION BUDGET: 17/20 - Only 3 remaining!"
- Helps the LLM prioritize and wrap up before hitting limits

## Loop Prevention

### Bot identity detection

`src/github/personas.ts` — `isCascadeBot(login)`

Both GitHub persona usernames (implementer + reviewer) are resolved and cached. Event handlers check if the event author is a known persona to prevent self-triggered loops:

- `respond-to-review` only fires when the **reviewer** persona submits `changes_requested`
- `respond-to-pr-comment` skips @mentions from **any** known persona
- Trello/JIRA handlers check their bot member/account IDs similarly

### Self-authored event filtering

Each `RouterPlatformAdapter.isSelfAuthored()` checks the webhook payload author against known bot identities. Self-authored events are logged and discarded at step 4 of the webhook pipeline.

## Security

### Environment scrubbing

`src/utils/envScrub.ts` — `scrubSensitiveEnv()`

After the worker initializes its DB connection and caches config, sensitive env vars (`DATABASE_URL`, master keys) are removed from `process.env`. This prevents LLM-generated shell commands (executed by agents) from accessing database credentials.

### Credential encryption at rest

See [08-config-credentials](./08-config-credentials.md) — AES-256-GCM encryption with transparent encrypt/decrypt.

## Orphan Cleanup

`src/router/orphan-cleanup.ts`

Periodic scan for Docker containers that outlived their expected lifetime (watchdog timeout + buffer). Orphans are killed and their run records marked as failed.

When a worker container exits non-zero, the router inspects it before Docker AutoRemove can reap it and writes a grep-stable error reason: `Worker crashed with exit code N · OOMKilled=<true|false> · reason="<State.Error>"`. `OOMKilled=true` is the definitive cgroup OOM signal; exit 137 without that marker means something else sent the signal.

## Snapshot Management

`src/router/snapshot-manager.ts`, `src/router/snapshot-cleanup.ts`

Optional container snapshots for warm restarts:
- After a worker completes, its container state can be snapshotted
- Subsequent runs for the same project reuse the snapshot (faster startup, cached dependencies)
- Snapshots have a configurable TTL (`snapshotTtlMs`) and are cleaned up periodically
