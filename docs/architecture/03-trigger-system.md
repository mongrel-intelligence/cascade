# Trigger System

The trigger system routes webhook events to the appropriate agent. When a webhook arrives, the router builds a `TriggerContext` and calls `TriggerRegistry.dispatch()` to find the first matching handler. The matched handler returns a `TriggerResult` specifying which agent to run and with what input.

## TriggerRegistry

`src/triggers/registry.ts`

A simple ordered list of handlers with first-match-wins dispatch:

```typescript
class TriggerRegistry {
  register(handler: TriggerHandler): void;
  dispatch(ctx: TriggerContext): Promise<TriggerResult | null>;
  getHandlers(): TriggerHandler[];
}
```

`dispatch()` iterates handlers in registration order. For each handler:
1. Call `matches(ctx)` — if `false`, skip
2. Call `handle(ctx)` — if it returns a `TriggerResult`, return it
3. If `handle()` returns `null`, continue to next handler

## TriggerHandler

`src/triggers/types.ts`

```typescript
interface TriggerHandler {
  name: string;
  description: string;
  matches(ctx: TriggerContext): boolean;
  handle(ctx: TriggerContext): Promise<TriggerResult | null>;
}
```

### TriggerContext

```typescript
interface TriggerContext {
  project: ProjectConfig;
  source: TriggerSource;          // 'trello' | 'github' | 'jira' | 'linear' | 'sentry'
  payload: unknown;                // Raw webhook payload
  personaIdentities?: PersonaIdentities;  // GitHub bot identities
}
```

### TriggerResult

```typescript
interface TriggerResult {
  agentType: string | null;        // Which agent to run
  agentInput: AgentInput;          // Input data for the agent
  workItemId?: string;
  workItemUrl?: string;
  workItemTitle?: string;
  prNumber?: number;
  prUrl?: string;
  prTitle?: string;
  onBlocked?: () => void;          // Cleanup if job can't be enqueued
  deferredRecheck?: {
    delayMs: number;
    coalesceKey: string;
  };                               // Schedule a bare delayed re-dispatch
}
```

## Built-in Triggers

Registration happens in `src/triggers/builtins.ts`. PM providers (Trello, JIRA, Linear) contribute triggers via the manifest registry; SCM and alerting providers use their own `register.ts` functions:

```typescript
function registerBuiltInTriggers(registry: TriggerRegistry): void {
  // PM providers register via the manifest registry (spec 006/009 pattern)
  for (const manifest of listPMProviders()) {
    for (const handler of manifest.triggerHandlers) {
      registry.register(handler);
    }
  }
  registerGitHubTriggers(registry);
  registerSentryTriggers(registry);
}
```

### Trello triggers (`src/triggers/trello/`)

| Handler | Event | Agent |
|---------|-------|-------|
| `TrelloCommentMentionTrigger` | Bot mentioned in comment | Varies by context |
| `TrelloStatusChangedSplittingTrigger` | Card → Splitting list | `splitting` |
| `TrelloStatusChangedPlanningTrigger` | Card → Planning list | `planning` |
| `TrelloStatusChangedTodoTrigger` | Card → Todo list | `implementation` |
| `TrelloStatusChangedBacklogTrigger` | Card → Backlog list | `backlog-manager` |
| `TrelloStatusChangedMergedTrigger` | Card → Merged list | `backlog-manager` |
| `ReadyToProcessLabelTrigger` | "cascade-ready" label added | `splitting` |

### JIRA triggers (`src/triggers/jira/`)

| Handler | Event | Agent |
|---------|-------|-------|
| `JiraCommentMentionTrigger` | Bot mentioned in comment | Varies |
| `JiraStatusChangedTrigger` | Issue status transition | Per-status mapping |
| `JiraLabelAddedTrigger` | "cascade-ready" label added | `splitting` |

### GitHub triggers (`src/triggers/github/`)

| Handler | Event | Agent |
|---------|-------|-------|
| `CheckSuiteSuccessTrigger` | CI passed | `review` (with `authorMode` param) |
| `CheckSuiteFailureTrigger` | CI failed | `respond-to-ci` |
| `PrReviewSubmittedTrigger` | Review with changes_requested | `respond-to-review` |
| `ReviewRequestedTrigger` | Bot requested as reviewer | `review` |
| `PrOpenedTrigger` | PR opened | `review` |
| `PrCommentMentionTrigger` | Bot @mentioned in PR comment | `respond-to-pr-comment` |
| `PrMergedTrigger` | PR merged | PM status update (no agent) |
| `PrReadyToMergeTrigger` | PR approved + checks pass | PM status update (no agent) |
| `PrConflictDetectedTrigger` | Merge conflict on PR | `resolve-conflicts` |

### Linear triggers (`src/triggers/linear/`)

| Handler | Event | Agent |
|---------|-------|-------|
| `LinearCommentMentionTrigger` | Bot @mentioned in issue comment | `respond-to-planning-comment` |
| `LinearStatusChangedTrigger` | Issue state transition | Per-status mapping |
| `LinearReadyToProcessLabelTrigger` | "cascade-ready" label added | `splitting` |

### Sentry triggers (`src/triggers/sentry/`)

| Handler | Event | Agent |
|---------|-------|-------|
| `AlertingIssueTrigger` | Sentry issue alert | `alerting` |
| `AlertingMetricTrigger` | Sentry metric alert | `alerting` |

## Trigger Configuration

### Event format

Triggers use category-prefixed events: `{category}:{event-name}`
- `pm:status-changed`, `pm:label-added`
- `scm:check-suite-success`, `scm:pr-review-submitted`, `scm:review-requested`
- `alerting:issue-alert`, `alerting:metric-alert`

### Deferred re-checks

Handlers that cannot make a final decision yet can return `deferredRecheck: { delayMs, coalesceKey }` with `agentType: null`. The router schedules a coalesced delayed BullMQ job and exits without spawning an agent. GitHub mergeability checks use this path; the worker recognizes re-check jobs via `mergeabilityRecheckAttempt` and captures a Sentry diagnostic if the second pass still cannot resolve state.

### Config resolution

`src/triggers/config-resolver.ts`

Each trigger handler calls `isTriggerEnabled()` to check if it should fire. Resolution follows a three-tier cascade:

1. **Database overrides** — `agent_trigger_configs` table entries per project/agent/event
2. **Definition defaults** — `defaultEnabled` and default parameters from YAML definitions
3. **Legacy fallback** — `project_integrations.triggers` JSONB (migrated automatically)

### Context pipeline

Each trigger in a YAML agent definition can declare a `contextPipeline` — an ordered list of context-fetching steps that run before the agent starts:

| Step | Purpose |
|------|---------|
| `directoryListing` | List repository file structure |
| `contextFiles` | Read key project files (README, etc.) |
| `workItem` | Fetch work item details from PM tool |
| `prepopulateTodos` | Pre-populate todo list from work item checklists |
| `prContext` | Fetch PR details, compact per-file diffs, CI checks; emit a `SKIPPED FILES` injection when files are omitted (over budget, deleted, binary) |
| `prConversation` | Fetch PR comments and review threads |
| `pipelineSnapshot` | Fetch CI pipeline status |
| `alertingIssue` | Fetch Sentry issue and event details |

## Shared Agent Execution

`src/triggers/shared/agent-execution.ts`

After a trigger matches, the shared execution layer handles the agent lifecycle:

```mermaid
flowchart TD
    A[Trigger matched] --> B[PM lifecycle: prepareForAgent]
    B --> C[Check budget]
    C -->|Over budget| D[Post budget warning, skip]
    C -->|Within budget| E[Resolve agent definition]
    E --> F[Set credential scope]
    F --> G[Run agent via engine]
    G -->|Success| H[PM lifecycle: handleSuccess]
    G -->|Failure| I[PM lifecycle: handleFailure]
    H --> J[Trigger debug analysis if configured]
    I --> J
```

This includes:
- PM lifecycle management (move card to "In Progress", post labels)
- Budget checking (`workItemBudgetUsd`)
- Credential scoping via `withCredentials()`
- Agent execution via `runAgent()` (see [05-engine-backends](./05-engine-backends.md))
- Post-run lifecycle (move card to "In Review", link PR, sync checklists)
- Debug analysis triggering on failure
- Deterministic review dispatch after a successful implementation run with a PR, using the same dedup key as the `scm:check-suite-success` trigger
