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

**Router side is fully unified** — all four providers (Trello, JIRA, GitHub, Sentry) share `processRouterWebhook()` + `RouterPlatformAdapter`. No provider-specific branching in the router.

**Worker side has intentional divergence** — see below.

---

## Worker-Side Handler Comparison

| Feature | PM (`processPMWebhook`) | GitHub (`processGitHubWebhook`) | Sentry (`processSentryWebhook`) |
|---------|------------------------|--------------------------------|--------------------------------|
| Trigger dispatch | ✅ Registry | ✅ Registry or pre-resolved | ✅ Registry or pre-resolved |
| Ack comment (PR) | ❌ N/A | ✅ Posts to PR | ❌ N/A |
| Ack comment (PM) | ✅ Via PM lifecycle | ✅ For PM-focused agents | ❌ N/A |
| CI check polling | ❌ N/A | ✅ `pollWaitForChecks()` | ❌ N/A |
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

1. **CI check polling** (`pollWaitForChecks`) — GitHub is the only provider with CI. No other source polls build status before running an agent.
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
| `trigger-resolution.ts` | `resolveTriggerResult()` — pre-resolved or dispatch | Sentry (GitHub and PM use inline logic) |
| `credential-scope.ts` | `withPMScope()` — `withPMCredentials` + `withPMProvider` | GitHub, Sentry |
| `pm-ack.ts` | `postPMAckComment()` — posts ack to Trello/JIRA | GitHub worker handler |
| `agent-execution.ts` | `runAgentExecutionPipeline()` — full agent lifecycle | All handlers (via `webhook-execution.ts`) |
| `webhook-execution.ts` | `runAgentWithCredentials()` — LLM keys + credentials + pipeline | GitHub, PM |

---

## Flow Diagrams

### PM webhook (Trello / JIRA)

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
processGitHubWebhook(payload, eventType, registry, ackCommentId, triggerResult)
  └─ integration.parseWebhookPayload(payload)       → event
  └─ integration.lookupProject(event.repo)          → project
  └─ [inline] if triggerResult → use it, else dispatchTrigger(registry, payload, project)
  └─ [optional] pollWaitForChecks(result, repo)     → checksOk
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
