# Integration Architecture

CASCADE uses a unified integration abstraction layer that lets PM, SCM, and alerting providers
plug in without changing core infrastructure. This guide explains the architecture and walks
through adding a new integration from scratch.

## Overview

Every integration is a class that implements `IntegrationModule` (and optionally a
category-specific sub-interface). Modules register themselves into `IntegrationRegistry` at
bootstrap time. Infrastructure — the router, worker, and webhook handler — looks up
integrations by `type` string and calls the standard interface methods, with no provider-specific
branching in shared code.

```
IntegrationModule (base contract)
├── PMIntegration       — project management (Trello, JIRA)
├── SCMIntegration      — source control (GitHub)
└── AlertingIntegration — monitoring/alerting (Sentry)
```

### Key files

| File | Purpose |
|------|---------|
| `src/integrations/types.ts` | `IntegrationModule` interface + `IntegrationWebhookEvent` |
| `src/integrations/registry.ts` | `IntegrationRegistry` class + `integrationRegistry` singleton |
| `src/integrations/scm.ts` | `SCMIntegration` interface (SCM-specific extension) |
| `src/integrations/alerting.ts` | `AlertingIntegration` interface (alerting-specific extension) |
| `src/integrations/bootstrap.ts` | **One place** — registers all 4 built-in integrations |
| `src/integrations/index.ts` | Public barrel exports |
| `src/pm/integration.ts` | `PMIntegration` interface (PM-specific extension) |
| `src/pm/registry.ts` | `PMIntegrationRegistry` singleton (PM-specific; backward compat) |
| `src/config/integrationRoles.ts` | Credential role definitions + `registerCredentialRoles()` |

### How data flows

```
Webhook arrives → Router webhook handler
  → RouterPlatformAdapter.parseWebhook()
  → RouterPlatformAdapter.dispatchWithCredentials()
    → TriggerRegistry.dispatch()
      → TriggerHandler.handle()   ← per-event business logic
  → RouterPlatformAdapter.postAck()  ← acknowledgment comment
  → BullMQ queue
    → Worker picks up job
      → Agent execution (backend + gadgets)
```

Each integration plugs in at three distinct layers:
1. **IntegrationModule / PMIntegration** — credential scoping and check
2. **RouterPlatformAdapter** — router-side webhook processing
3. **TriggerHandler(s)** — event-to-agent routing

---

## Integration categories

### PM (Project Management)

Implements `PMIntegration` (extends `IntegrationModule`). Required for any board/issue-tracker
provider. In addition to the base `IntegrationModule` methods, PM integrations implement:

- `createProvider(project)` — returns a `PMProvider` for data operations (read/write cards, lists)
- `resolveLifecycleConfig(project)` — normalises provider-specific config into `ProjectPMConfig`
  (labels, statuses)
- `parseWebhookPayload(raw)` → `PMWebhookEvent | null`
- `isSelfAuthored(event, projectId)` — filter bot-authored events
- `postAckComment`, `deleteAckComment`, `sendReaction` — router-side acknowledgment operations
- `lookupProject(identifier)` — map board/project identifier → project config
- `extractWorkItemId(text)` — parse work-item ID from freeform text (e.g. PR body)

Implementations live in `src/pm/<provider>/integration.ts`.
Example: `src/pm/trello/integration.ts`, `src/pm/jira/integration.ts`.

PM integrations are registered in **both** the `integrationRegistry` (unified) and the
`pmRegistry` (PM-specific, backward compat).

### SCM (Source Control)

Implements `SCMIntegration` (extends `IntegrationModule`). Required for PR-based workflows.
Adds `hasPersonaToken(projectId, persona)` — check whether an implementer or reviewer token
is configured.

Implementation: `src/github/scm-integration.ts` (`GitHubSCMIntegration`).

### Alerting

Implements `AlertingIntegration` (extends `IntegrationModule`). Required for alert-triggered
automation. Adds `getConfig(projectId)` — retrieve the provider-specific alerting config.

Implementation: `src/sentry/alerting-integration.ts` (`SentryAlertingIntegration`).

---

## Adding a new integration — step by step

The example below adds a hypothetical **Linear** PM integration. Adapt the names for your actual
provider and category.

### Step 1 — Implement the interface

Create `src/pm/linear/integration.ts` (for a PM integration) implementing `PMIntegration`:

```typescript
import { registerCredentialRoles } from '../../config/integrationRoles.js';
import { getIntegrationCredential, getIntegrationCredentialOrNull } from '../../config/provider.js';
import { getIntegrationProvider } from '../../db/repositories/credentialsRepository.js';
import type { PMIntegration, PMWebhookEvent } from '../integration.js';
import type { ProjectPMConfig } from '../lifecycle.js';
import type { ProjectConfig } from '../../types/index.js';
import type { PMProvider } from '../types.js';

// Self-register credential roles at module load time
registerCredentialRoles('linear', 'pm', [
  { role: 'api_key', label: 'API Key', envVarKey: 'LINEAR_API_KEY' },
  { role: 'webhook_secret', label: 'Webhook Secret', envVarKey: 'LINEAR_WEBHOOK_SECRET', optional: true },
]);

export class LinearIntegration implements PMIntegration {
  readonly type = 'linear';
  readonly category = 'pm' as const;

  async hasIntegration(projectId: string): Promise<boolean> {
    const provider = await getIntegrationProvider(projectId, 'pm');
    if (provider !== 'linear') return false;
    const key = await getIntegrationCredentialOrNull(projectId, 'pm', 'api_key');
    return key !== null;
  }

  createProvider(project: ProjectConfig): PMProvider {
    return new LinearPMProvider(); // your PMProvider adapter
  }

  async withCredentials<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    const apiKey = await getIntegrationCredential(projectId, 'pm', 'api_key');
    // set process.env.LINEAR_API_KEY, call fn, restore
    const prev = process.env.LINEAR_API_KEY;
    process.env.LINEAR_API_KEY = apiKey;
    try {
      return await fn();
    } finally {
      process.env.LINEAR_API_KEY = prev;
    }
  }

  resolveLifecycleConfig(project: ProjectConfig): ProjectPMConfig {
    // map Linear-specific config → normalised ProjectPMConfig
    const cfg = project.pm?.config as Record<string, unknown> | undefined;
    return {
      labels: { processing: cfg?.processingLabel as string | undefined },
      statuses: { todo: cfg?.todoStateId as string | undefined },
    };
  }

  parseWebhookPayload(raw: unknown): PMWebhookEvent | null {
    // parse raw Linear webhook body → PMWebhookEvent
    // return null if irrelevant
    return null; // implement per Linear webhook format
  }

  async isSelfAuthored(event: PMWebhookEvent, projectId: string): Promise<boolean> {
    return false; // implement bot identity check
  }

  async postAckComment(projectId: string, workItemId: string, message: string): Promise<string | null> {
    return null; // call Linear API to post comment
  }

  async deleteAckComment(projectId: string, workItemId: string, commentId: string): Promise<void> {
    // call Linear API to delete comment
  }

  async sendReaction(projectId: string, event: PMWebhookEvent): Promise<void> {
    // send emoji reaction if Linear supports it
  }

  async lookupProject(identifier: string) {
    // look up project by Linear team ID or similar
    return null;
  }

  extractWorkItemId(text: string): string | null {
    const match = text.match(/https:\/\/linear\.app\/[^/]+\/issue\/([A-Z]+-\d+)/);
    return match?.[1] ?? null;
  }
}
```

> **SCM integration** — implement `SCMIntegration` from `src/integrations/scm.ts` instead,
> and place the file in `src/<provider>/scm-integration.ts`.
>
> **Alerting integration** — implement `AlertingIntegration` from `src/integrations/alerting.ts`
> instead, and place the file in `src/<provider>/alerting-integration.ts`.

### Step 2 — Register credential roles

Credential roles map a logical `role` name → env-var key. They tell the config provider how to
resolve credentials for the integration and let the dashboard/CLI enumerate them.

Call `registerCredentialRoles()` at module load time (shown in Step 1 above):

```typescript
import { registerCredentialRoles } from '../../config/integrationRoles.js';

registerCredentialRoles('linear', 'pm', [
  { role: 'api_key', label: 'API Key', envVarKey: 'LINEAR_API_KEY' },
  { role: 'webhook_secret', label: 'Webhook Secret', envVarKey: 'LINEAR_WEBHOOK_SECRET', optional: true },
]);
```

Roles marked `optional: true` are excluded from the "all required credentials present" check in
`hasIntegration()`. Roles without `optional` are **required**.

Role definitions live in `src/config/integrationRoles.ts`. The built-in providers (trello, jira,
github, sentry) are hardcoded there; new providers use `registerCredentialRoles()` instead.

### Step 3 — Register in bootstrap

Open `src/integrations/bootstrap.ts` and add your integration:

```typescript
// src/integrations/bootstrap.ts
import { LinearIntegration } from '../pm/linear/integration.js';

// ... existing registrations ...

if (!pmRegistry.getOrNull('linear')) {
  const linear = new LinearIntegration();
  pmRegistry.register(linear);
  if (!integrationRegistry.getOrNull('linear')) integrationRegistry.register(linear);
}
```

For an SCM integration, register only in `integrationRegistry`:
```typescript
if (!integrationRegistry.getOrNull('gitlab')) {
  integrationRegistry.register(new GitLabSCMIntegration());
}
```

Bootstrap is safe to import from both the **router** and **worker** — it does not pull in
template files or agent execution code.

### Step 4 — Add a webhook route in the router

Open `src/router/index.ts` and add a route for the new provider's webhook:

```typescript
// Existing pattern:
app.post('/webhook/trello', verifyWebhookSignature('trello'), async (c) => {
  const payload = await c.req.json();
  return processRouterWebhook(c, 'trello', payload, trelloAdapter, triggerRegistry);
});

// New route:
app.post('/webhook/linear', verifyWebhookSignature('linear'), async (c) => {
  const payload = await c.req.json();
  return processRouterWebhook(c, 'linear', payload, linearAdapter, triggerRegistry);
});
```

Webhook signature verification is opt-in. See `src/router/webhookVerification.ts` for details on
how HMAC verification works and how to add support for a new provider's signature format.

### Step 5 — Create a router adapter

Create `src/router/adapters/linear.ts` implementing `RouterPlatformAdapter`:

```typescript
import type { RouterPlatformAdapter, AckResult, ParsedWebhookEvent } from '../platform-adapter.js';

export class LinearRouterAdapter implements RouterPlatformAdapter {
  readonly type = 'linear' as const;

  async parseWebhook(payload: unknown): Promise<ParsedWebhookEvent | null> {
    // Extract projectIdentifier, eventType, workItemId from Linear payload
    // Return null for unrecognised or non-processable payloads
    return null;
  }

  isProcessableEvent(event: ParsedWebhookEvent): boolean {
    return true; // already filtered in parseWebhook
  }

  async isSelfAuthored(event: ParsedWebhookEvent, payload: unknown): Promise<boolean> {
    return false;
  }

  sendReaction(event: ParsedWebhookEvent, payload: unknown): void {
    // fire-and-forget reaction
  }

  async resolveProject(event: ParsedWebhookEvent): Promise<RouterProjectConfig | null> {
    // load project config, find by event.projectIdentifier
    return null;
  }

  async dispatchWithCredentials(event, payload, project, triggerRegistry) {
    const ctx: TriggerContext = { project: fullProject, source: 'linear', payload };
    return withLinearCredentials(() => triggerRegistry.dispatch(ctx));
  }

  async postAck(event, payload, project, agentType): Promise<AckResult | undefined> {
    // post acknowledgment comment
    return undefined;
  }

  buildJob(event, payload, project, result, ackResult): CascadeJob {
    return {
      type: 'linear',
      source: 'linear',
      payload,
      projectId: project.id,
      workItemId: event.workItemId ?? '',
      actionType: event.eventType,
      receivedAt: new Date().toISOString(),
      triggerResult: result,
      ackCommentId: ackResult?.commentId as string | undefined,
    };
  }
}
```

The adapter is instantiated once and passed directly to `processRouterWebhook()` — no registry
lookup needed. See `src/router/adapters/trello.ts` for a complete reference implementation.

### Step 6 — Create trigger handlers

Trigger handlers fire for specific events and decide which agent to invoke.

**Create `src/triggers/linear/status-changed.ts`:**

```typescript
import type { TriggerHandler, TriggerContext, TriggerResult } from '../../types/index.js';

export const LinearStatusChangedTodoTrigger: TriggerHandler = {
  id: 'linear:status-changed:todo',

  // Supported trigger events (used by cascade definitions triggers / trigger-discover)
  supportedTriggers: [{ category: 'pm', event: 'pm:status-changed' }],

  async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
    // ctx.payload is the raw Linear webhook payload
    // ctx.project is the full ProjectConfig
    // Return null to skip, or a TriggerResult to dispatch an agent
    return null;
  },
};
```

**Create `src/triggers/linear/register.ts`:**

```typescript
import type { TriggerRegistry } from '../registry.js';
import { LinearStatusChangedTodoTrigger } from './status-changed.js';

export function registerLinearTriggers(registry: TriggerRegistry): void {
  registry.register(LinearStatusChangedTodoTrigger);
  // add more triggers as needed
}
```

**Register in `src/triggers/builtins.ts`:**

```typescript
import { registerLinearTriggers } from './linear/register.js';

export function registerBuiltInTriggers(registry: TriggerRegistry): void {
  // existing registrations ...
  registerLinearTriggers(registry);
}
```

> **Important:** `builtins.ts` must only import trigger _handler_ classes, not webhook handlers.
> Webhook handlers transitively pull in the agent execution pipeline (including `.eta` template
> files that are not present in the router Docker image). Importing them from `builtins.ts`
> would crash the router.

### Step 7 — Add gadgets and capabilities

Gadgets are the tools agents use during execution. PM, SCM, and alerting gadgets live in
`src/gadgets/pm/`, `src/gadgets/github/`, and `src/gadgets/sentry/` respectively.

If your integration requires new gadget operations not already covered by the provider-agnostic
PM gadgets (`ReadWorkItem`, `PostComment`, etc.), add them in `src/gadgets/<provider>/`.

Each gadget:
1. Has a `ToolDefinition` in `definitions.ts` (or equivalent)
2. Is implemented as a class in its own file
3. Is exported from the directory's `index.ts`
4. Is listed in the relevant agent YAML definitions under `tools:`

Agent YAML definitions live in `src/agents/definitions/`. Add your gadgets to the relevant
agent's `tools:` list, or create a new agent definition via `cascade definitions import`.

See `src/gadgets/sentry/` for a compact three-gadget example.

---

## Testing checklist

Before submitting a new integration:

- [ ] `IntegrationModule` interface fully implemented (type, category, withCredentials, hasIntegration)
- [ ] `registerCredentialRoles()` called at module load time with all credential roles
- [ ] Integration registered in `src/integrations/bootstrap.ts`
- [ ] Webhook route added in `src/router/index.ts`
- [ ] `RouterPlatformAdapter` implemented in `src/router/adapters/<provider>.ts`
- [ ] At least one `TriggerHandler` implemented in `src/triggers/<provider>/`
- [ ] Trigger handlers registered via `registerBuiltInTriggers()` in `src/triggers/builtins.ts`
- [ ] `src/triggers/<provider>/register.ts` created with `registerXxxTriggers(registry)`
- [ ] Gadgets added for any new provider-specific operations
- [ ] Unit tests for the `IntegrationModule` implementation (see `tests/unit/pm/` for examples)
- [ ] Unit tests for trigger handlers (see `tests/unit/triggers/` for examples)
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes

---

## Reference: built-in integrations

| Provider | Category | Module file | Adapter | Triggers |
|----------|----------|-------------|---------|---------|
| `trello` | pm | `src/pm/trello/integration.ts` | `src/router/adapters/trello.ts` | `src/triggers/trello/` |
| `jira` | pm | `src/pm/jira/integration.ts` | `src/router/adapters/jira.ts` | `src/triggers/jira/` |
| `github` | scm | `src/github/scm-integration.ts` | `src/router/adapters/github.ts` | `src/triggers/github/` |
| `sentry` | alerting | `src/sentry/alerting-integration.ts` | `src/router/adapters/sentry.ts` | `src/triggers/sentry/` |
