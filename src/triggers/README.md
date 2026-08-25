# Trigger System

This directory contains the trigger handlers and registry that route webhook events to agents.

## Architecture Overview

```
Webhook → Router → Redis/BullMQ → Worker → TriggerRegistry → Agent
```

### Two-tier webhook handling

Webhook processing is split into two distinct tiers:

| Tier | Where | Purpose |
|------|-------|---------|
| **Router** | `src/router/` | Receive, validate, acknowledge, enqueue |
| **Worker** | `src/triggers/` | Resolve trigger, establish credentials, run agent |

**Router side is fully unified** — Trello, JIRA, Linear, GitHub, and Sentry share `processRouterWebhook()` + `RouterPlatformAdapter`. No provider-specific branching in the router.

**Worker side has intentional divergence** — see below.

---

## Worker-Side Handler Comparison

| Feature | PM (`processPMWebhook`) | GitHub (`processGitHubWebhook`) | Sentry (`processSentryWebhook`) |
|---------|------------------------|--------------------------------|--------------------------------|
| Trigger dispatch | ✅ Registry | ✅ Registry or pre-resolved | ✅ Registry or pre-resolved |
| Ack comment (PR) | ❌ N/A | ✅ Posts to PR | ❌ N/A |
| Ack comment (PM) | ✅ Via PM lifecycle | ✅ For PM-focused agents | ❌ N/A |
| Check-suite decision | ❌ N/A | ✅ Aggregate check-run state in trigger handlers | ❌ N/A |
| PM credential scope | ✅ `integration.withCredentials` | ✅ `withPMCredentials` | ✅ `withPMCredentials` |
| PM lifecycle ops | ✅ prepareForAgent / handleFailure | ✅ For PM-focused agents | ❌ Skipped |
| Persona token mgmt | ❌ N/A | ✅ Implementer / reviewer | ❌ N/A |
| Agent concurrency | ✅ `checkAgentTypeConcurrency` | ✅ `withAgentTypeConcurrency` | ✅ `withAgentTypeConcurrency` |

---

## Why GitHub and Sentry Cannot Use `processPMWebhook()`

`processPMWebhook()` assumes **PM semantics**:
- It calls `integration.parseWebhookPayload()` expecting a PM event (card ID, board identifier)
- It drives `PMLifecycleManager` (prepareForAgent → handleFailure / handleSuccess)
- The `PMIntegration` interface provides card parsing, ack cleanup, and credential scoping

Forcing GitHub or Sentry into this pipeline would require:
- Provider-specific `if` branches inside `processPMWebhook()` — worse than current design
- Mocking PM lifecycle ops (they don't apply to Sentry alerts or GitHub PRs)

### GitHub-specific features (cannot be generalized)

1. **Check-suite aggregation** — GitHub is the only provider with CI. The check-suite triggers inspect aggregate check-run state for the PR head SHA and either dispatch `review`, dispatch `respond-to-ci`, or return a structured skip while checks are incomplete. Worker-side CI polling is intentionally not part of this path.
2. **PR acknowledgment comments** — GitHub PRs get a comment like "👀 Reviewing…" immediately. No other source has this flow.
3. **Dual-persona token management** — The implementer vs. reviewer persona selection is GitHub-specific. No Trello/JIRA/Sentry equivalent.
4. **PM-focused agent routing** — When a PM-focused agent (e.g. `backlog-manager`) fires from a GitHub PR event, it posts the ack to Trello/JIRA instead of the PR, and uses PM-appropriate lifecycle config.

### Sentry-specific simplicity (intentional)

Sentry is an alerting source. There are no:
- Work item cards to manage lifecycle on
- PR comments to post
- CI checks to poll

Sentry's handler is intentionally minimal: load project, resolve trigger, run agent in PM scope.

---

## Shared Utilities (`src/triggers/shared/`)

To reduce duplication across the three worker-side handlers, shared utilities are extracted to `src/triggers/shared/`:

| File | Purpose | Used By |
|------|---------|---------|
| `concurrency.ts` | `withAgentTypeConcurrency()` — wraps check→mark→execute→clear | GitHub, Sentry |
| `trigger-resolution.ts` | `resolveTriggerResult()` — pre-resolved or dispatch | GitHub, PM, Sentry |
| `credential-scope.ts` | `withPMScope()` — `withPMCredentials` + `withPMProvider` | GitHub, Sentry |
| `pm-ack.ts` | `postPMAckComment()` — posts ack to Trello/JIRA | GitHub worker handler |
| `events.ts` | `TRIGGER_EVENTS` — typed catalog of canonical trigger event names | Trigger handlers and tests |
| `result-builders.ts` | Builders for dispatch, skip, no-agent, and deferred re-check `TriggerResult` shapes | Trigger handlers and tests |
| `agent-execution.ts` | `runAgentExecutionPipeline()` — thin facade that orders validation, linking, prepare/run, post-run work, callbacks, follow-up dispatch, and auto-debug | All handlers (via `webhook-execution.ts`) |
| `agent-execution-runtime.ts` | Context setup, lifecycle hook loading, `runAgent()` invocation, PR/work-item linking, PM summaries, and source callbacks | `agent-execution.ts` |
| `agent-execution-lifecycle.ts` | Integration validation, pre/post budget checks, PM prepare/cleanup/success/failure lifecycle, and artifact handling | `agent-execution.ts` |
| `agent-work-items.ts` | Runtime work-item re-resolution, pre-run work-item persistence, PR/work-item linking, and run PR-number backfill | `agent-execution-runtime.ts` |
| `agent-pm-summary.ts` | Cross-source PM summaries for review and output-based agents | `agent-execution-runtime.ts` |
| `agent-execution-followups.ts` | Recursive follow-up dispatch for post-completion review and splitting auto-chain | `agent-execution.ts` |
| `post-completion-review.ts` | Builds the deterministic review dispatch after a successful implementation PR with passing CI | `agent-execution-followups.ts` |
| `splitting-auto-chain.ts` | Propagates the auto label after splitting and optionally chains backlog-manager | `agent-execution-followups.ts` |
| `agent-auto-debug.ts` | Triggers configured debug analysis after failed or timed-out runs; the shared runner records a durable, cross-process status (see [Debug-analysis status](#debug-analysis-status-durable-cross-process)) | `agent-execution.ts` |
| `webhook-execution.ts` | `runAgentWithCredentials()` — LLM keys + credentials + pipeline | GitHub, PM |

### Debug-analysis status (durable, cross-process)

`agent-auto-debug.ts` and the manual dashboard "Run Analysis" button both drive the shared `triggerDebugAnalysis()` runner in `debug-runner.ts`. Because the analysis runs in a separate worker container from the dashboard API that polls its progress, the running/failed lifecycle is recorded in the **durable, cross-process** `debug_analysis_status` table (`debugAnalysisRepository.ts`), not an in-process flag — an in-memory flag in the worker is invisible to the dashboard process. The runner marks `running` around the analysis, clears the row on success (a persisted `debug_analyses` row is then the `completed` signal), and marks `failed` on a catchable in-process error.

`runs.getDebugAnalysisStatus` reads that table uniformly in queue mode and local dev (precedence: active `running` → `completed` → `failed` → `idle`; a row older than `DEBUG_ANALYSIS_RUNNING_STALE_MS` self-stales to `idle`). The deterministic `debug-analysis-<runId>` dashboard job (`debugAnalysisJobId()` in `src/queue/client.ts`) only provides idempotent re-enqueue + double-trigger dedup, since a BullMQ job reaches `completed` at container spawn rather than at analysis completion. An earlier in-memory `Set` (`debug-status.ts`) was removed because it was never visible to the dashboard process (MNG-1667). Full write-up: [`docs/architecture/01-services.md`](../../docs/architecture/01-services.md) and [`docs/architecture/03-trigger-system.md`](../../docs/architecture/03-trigger-system.md).

---

## Trigger Authoring Contracts

### Canonical events

Use `TRIGGER_EVENTS` from `src/triggers/shared/events.ts` for every new trigger event. The catalog is the source of truth for event IDs written into `agentInput.triggerEvent`, trigger configuration rows, and static consistency tests:

| Category | Events |
|----------|--------|
| `PM` | `pm:status-changed`, `pm:label-added`, `pm:comment-mention` |
| `SCM` | `scm:check-suite-success`, `scm:check-suite-failure`, `scm:pr-review-submitted`, `scm:review-requested`, `scm:pr-opened`, `scm:pr-comment-mention`, `scm:pr-merged`, `scm:pr-ready-to-merge`, `scm:pr-conflict-detected` |
| `ALERTING` | `alerting:issue-alert`, `alerting:metric-alert` |
| `INTERNAL` | `internal:auto-chain` |

Do not introduce raw event-string literals in new handlers. If a handler checks `checkTriggerEnabled(..., event, ...)`, the same event must be emitted as `agentInput.triggerEvent`; `tests/unit/triggers/trigger-event-consistency.test.ts` enforces that invariant because mismatches make enabled triggers silently fall back to YAML defaults.

### Result builders

Prefer the shared builders instead of hand-assembling `TriggerResult` objects:

| Builder | Use |
|---------|-----|
| `buildPMDispatchResult` | Generic PM dispatch shape with `workItemId` and canonical trigger event |
| `buildPMStatusDispatchResult` | PM status-transition dispatch plus PM coalescing key |
| `buildPMLabelDispatchResult` | PM label-trigger dispatch |
| `buildGitHubPRDispatchResult` | Generic GitHub PR dispatch shape with `prNumber`, PR metadata, and optional PM work-item metadata |
| `buildReviewResult`, `buildRespondToCiResult`, `buildResolveConflictsResult` | GitHub-specific agent input shapes |
| `buildNoAgentResult` | Matched trigger completed a side effect but should not spawn an agent |
| `buildSkipResult` / `skip()` | Matched handler deliberately self-skipped and should stop registry dispatch with a structured reason |
| `buildDeferredRecheckResult` | **GitHub-only** — Router schedules a bare delayed job; the GitHub worker re-dispatches through the registry for fresh provider state. Non-GitHub adapters embed `triggerResult` in the job, so their workers return the same `agentType: null` result without re-dispatching. See the **Deferred re-check** section below. |

### `null` vs structured skip

`TriggerRegistry.dispatch()` is first-match dispatch with one important distinction:

- Return bare `null` only when this handler does not claim the event and the registry should continue to later handlers.
- Return `buildSkipResult(handler, message)` when the handler did claim the event but chose not to run an agent, such as disabled config, loop-prevention gates, incomplete aggregate checks, or missing prerequisite state. The router logs a stable decision reason: `Trigger <handler> skipped: <message>`.

This distinction prevents "No trigger matched for event" from hiding real handler decisions.

### Deferred re-check

`buildDeferredRecheckResult` is currently a **GitHub-only** contract for bare re-dispatch. The router always schedules the delayed job via `scheduleCoalescedJob` and exits without taking dispatch locks or posting an ack — that part is generic. What differs is what the worker does when the job fires:

- **GitHub adapter** — `GitHubRouterAdapter.buildJob()` strips `triggerResult` from the job. The recheck kind is controlled by the optional `recheckKind` field on `deferredRecheck`: if absent (mergeability re-check), `mergeabilityRecheckAttempt: 1` is set and the worker emits `mergeability_recheck_exhausted` if the re-check still cannot resolve state (one-shot, no re-queueing); if `recheckKind === 'check-suite'`, `checkSuiteRecheckAttempt: 1` is set and the worker safely reschedules another coalesced delayed job when the Actions API is still stale, so dispatch stays alive until the API catches up. `check-suite-success` and `check-suite-failure` use the `check-suite` kind for the Actions-API-lag case.
- **Non-GitHub adapters (Trello, JIRA, Linear, Sentry)** — these adapters always embed `triggerResult` in the job regardless of `deferredRecheck`. When the job fires, `resolveTriggerResult()` receives the pre-resolved result and returns it directly, skipping registry dispatch. A non-GitHub handler returning `buildDeferredRecheckResult` would therefore schedule a job that re-uses the same `agentType: null` result instead of re-evaluating provider state.

Use this builder only in GitHub handlers unless the adapter and worker for your provider have been updated to support bare re-dispatch.

### Handler rules

- `matches(ctx)` should be cheap, source-specific, and side-effect free.
- `handle(ctx)` owns expensive lookups, trigger-config checks, and the final dispatch decision.
- PM status and label handlers should use shared PM helpers so Trello, JIRA, and Linear stay behaviorally aligned.
- GitHub PR agent dispatch should use the GitHub result builders so PR metadata, work-item metadata, `headSha`, and `triggerType` remain consistent.
- Prefer structured skip over throwing for expected non-dispatch reasons. Throwing from router dispatch is treated as non-fatal by the router and loses handler-specific decision detail.

---

## Flow Diagrams

### PM webhook (Trello / JIRA / Linear)

```
processPMWebhook(integration, payload, registry)
  └─ integration.parseWebhookPayload(payload)       → event
  └─ integration.lookupProject(event.identifier)    → project
  └─ integration.withCredentials(projectId)
       └─ withPMProvider(pmProvider)
            └─ resolveTriggerResult(registry, ctx, preResolved)
            └─ handleMatchedTrigger(...)
                 └─ withAgentTypeConcurrency(projectId, agentType)
                 └─ startWatchdog()
                 └─ executeAgent() → runAgentWithCredentials()
                      └─ injectLlmApiKeys()
                      └─ withGitHubToken(personaToken)
                      └─ runAgentExecutionPipeline(...)
```

### GitHub webhook

```
processGitHubWebhook(payload, eventType, registry, ackCommentId, triggerResult, ..., projectId)
  └─ integration.parseWebhookPayload(payload)       → event
  └─ loadProjectConfigById(projectId)               → project   (link-first, spec 024;
       falls back to integration.lookupProject(event.repo) for pre-024 jobs)
  └─ resolveTriggerResult(registry, ctx, triggerResult)   → result
  └─ check-suite handlers inspect aggregate check-run state before dispatch
  └─ maybePostAckComment(result, ...)               → PR or PM ack
  └─ runGitHubAgent(result, project, config)
       └─ withAgentTypeConcurrency(projectId, agentType)
            └─ startWatchdog()
            └─ withPMScope(project)
                 └─ runAgentWithCredentials(integration, result, ...)
```

### Sentry webhook

```
processSentryWebhook(payload, projectId, registry, triggerResult)
  └─ loadProjectConfigById(projectId)               → project
  └─ resolveTriggerResult(registry, ctx, preResolved)
  └─ withAgentTypeConcurrency(projectId, agentType)
       └─ startWatchdog()
            └─ withPMScope(project)
                 └─ runAgentExecutionPipeline(result, ...)
```

### Agent execution facade

```
runAgentExecutionPipeline(result, project, config, executionConfig)
  └─ guard: skip no-agent TriggerResult values
  └─ createAgentExecutionContext()
       └─ create PM lifecycle manager
       └─ load agent lifecycle hooks
       └─ re-resolve workItemId from stored PR/work-item links when needed
  └─ validateAgentExecutionLifecycle()
       └─ validate PM/SCM credentials and notify PM/callbacks on preflight failure
  └─ checkPreRunBudget()
       └─ stop before run when workItemBudgetUsd is exceeded
  └─ persistAgentWorkItemLinks()
       └─ create/update work-item records and PR/work-item links before the run
  └─ prepareAgentExecutionLifecycle()
       └─ PM prepareForAgent unless the source config skips it
  └─ runAgentForContext()
       └─ runAgent(agentType, agentInput + project/config/remainingBudgetUsd)
  └─ runPostAgentSideEffects()
       └─ link created PRs back to work items and post PM summaries
  └─ runPostAgentExecutionLifecycle()
       └─ artifacts, post-run budget warning, cleanupProcessing, handleSuccess/Failure
  └─ runAgentExecutionCallbacks()
       └─ source-specific success/failure callbacks
  └─ dispatchAgentFollowUps()
       └─ implementation success + green CI → review dispatch
       └─ splitting success + auto label → backlog-manager auto-chain
  └─ triggerAutoDebugIfNeeded()
       └─ fire-and-forget debug analysis for eligible failed/timed-out runs
```
