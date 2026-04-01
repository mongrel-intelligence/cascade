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
- Marked when job is enqueued, cleared when worker completes
- Key: `(projectId, workItemId, agentType)`

### Agent-type concurrency limit

`src/router/agent-type-lock.ts`

Configurable `max_concurrency` per agent type per project (set via `agent_configs.max_concurrency`). Prevents too many instances of the same agent type running simultaneously.

- Tracks enqueued + running counts
- Blocks new jobs when limit reached
- Includes a "recently dispatched" window to prevent race conditions between enqueueing and worker startup

### Max in-flight items

`projects.max_in_flight_items` — project-level cap on total concurrent agent runs. Checked during trigger dispatch.

### BullMQ concurrency

The router's worker manager limits how many Docker containers run in parallel via `routerConfig.maxWorkers`.

## Rate Limiting

`src/config/rateLimits.ts`

Proactive, model-specific rate limits prevent hitting LLM provider quotas. Configured per model with safety margins (80-90% of actual limits):

- **RPM** (requests per minute)
- **TPM** (tokens per minute)
- **Daily token limit**

Rate limits are enforced by the LLMist SDK for `sdk`-archetype engines. Native-tool engines (Claude Code, Codex) handle rate limiting internally.

## Retry Strategy

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

## Snapshot Management

`src/router/snapshot-manager.ts`, `src/router/snapshot-cleanup.ts`

Optional container snapshots for warm restarts:
- After a worker completes, its container state can be snapshotted
- Subsequent runs for the same project reuse the snapshot (faster startup, cached dependencies)
- Snapshots have a configurable TTL (`snapshotTtlMs`) and are cleaned up periodically
