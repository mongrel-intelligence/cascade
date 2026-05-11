# Integration Layer

CASCADE uses a unified integration layer so infrastructure code (router, worker, webhook handlers) looks up integrations through registries instead of branching on provider type. PM providers use the newer `PMProviderManifest` registry; SCM (GitHub) and alerting (Sentry) still use the legacy `IntegrationModule` path and mirror into the same cross-category `IntegrationRegistry`.

## IntegrationModule

`src/integrations/types.ts`

The base contract for SCM and alerting integrations, and the compatibility surface that PM manifests mirror into:

```typescript
interface IntegrationModule {
  readonly type: string;              // 'trello', 'jira', 'linear', 'github', 'sentry'
  readonly category: IntegrationCategory; // 'pm' | 'scm' | 'alerting'

  withCredentials<T>(projectId: string, fn: () => Promise<T>): Promise<T>;
  hasIntegration(projectId: string): Promise<boolean>;

  // Optional webhook methods
  parseWebhookPayload?(raw: unknown): IntegrationWebhookEvent | null;
  isSelfAuthored?(event: unknown, projectId: string): Promise<boolean>;
  lookupProject?(identifier: string): Promise<{ project; config } | null>;
  extractWorkItemId?(text: string): string | null;
}
```

### Credential scoping

`withCredentials()` uses `AsyncLocalStorage` to set provider-specific credentials for the duration of a callback. This provides per-request credential isolation without global state mutation.

### Integration checking

`hasIntegration()` checks that all required credential roles for the provider are configured for the given project. Role definitions come from `src/config/integrationRoles.ts`.

## IntegrationRegistry

`src/integrations/registry.ts`

```typescript
class IntegrationRegistry {
  register(integration: IntegrationModule): void;
  get(type: string): IntegrationModule;          // throws if missing
  getOrNull(type: string): IntegrationModule | null;
  getByCategory(category: IntegrationCategory): IntegrationModule[];
  all(): IntegrationModule[];
}

const integrationRegistry: IntegrationRegistry;  // singleton
```

## Category Interfaces

### PMProviderManifest and PMIntegration

`src/integrations/pm/manifest.ts` — the manifest is the single PM-provider contract. Trello, JIRA, and Linear each declare identity, credential roles, webhook route/signature verification, router adapter, trigger handlers, platform ack client, config schema, discovery capabilities, wizard spec, and lifecycle fixture in one provider-owned object.

The PM barrel (`src/integrations/pm/index.ts`) imports each provider once, then mirrors each manifest's `pmIntegration` into `integrationRegistry`. New PM providers add one provider folder plus one import in that barrel; shared router, worker, dashboard, CLI, and config files are guarded against provider-specific edits by conformance tests.

The dashboard has a matching frontend PM-provider boundary under `web/src/components/projects/pm-providers/<provider>/`. A provider owns its wizard definition, auth metadata, credential persistence metadata, save config serialization, edit-mode hydration, discovery/mutation hooks, webhook UX composition, and provider-specific state slice in that folder. The shared wizard files (`pm-wizard.tsx`, `pm-wizard-hooks.ts`, and `pm-wizard-common-steps.tsx`) only render registered provider definitions and run metadata-driven verification/save helpers, so adding a provider does not require editing them. New providers add one frontend barrel import in `web/src/components/projects/pm-providers/index.ts`; `pm-wizard-state.ts` is the remaining explicit shared-dashboard exception while it composes provider state slices into the aggregate `WizardState` and reducer.

`src/pm/integration.ts` — extends `IntegrationModule` with PM-specific methods:

- `createProvider(project)` — create a `PMProvider` instance for CRUD operations
- `resolveLifecycleConfig(project)` — extract labels, statuses, list IDs from project config
- `postAckComment(projectId, workItemId, message)` — post acknowledgment comment
- `deleteAckComment(projectId, workItemId, commentId)` — remove ack comment
- `sendReaction(projectId, event)` — add emoji reaction to source event
- `lookupProject(identifier)` — find project by board ID or project key
- `extractWorkItemId(text)` — parse work item ID from text (e.g., Trello URL, JIRA key)

### SCMIntegration

`src/integrations/scm.ts` — extends `IntegrationModule` with SCM-specific methods for webhook payload parsing and project lookup by repository name.

### AlertingIntegration

`src/integrations/alerting.ts` — extends `IntegrationModule` with alerting-specific methods.

## Bootstrap

`src/integrations/entrypoint.ts`

Single registration entrypoint for all runtime surfaces. Router, worker, CLI bootstrap, dashboard, and tests import it for side effects.

```
PM barrel                 → pmProviderRegistry + integrationRegistry
GitHub register.ts        → integrationRegistry + trigger handlers
Sentry register.ts        → integrationRegistry + trigger handlers
```

## Credential Roles

`src/config/integrationRoles.ts`

Each provider declares its credential roles — the mapping from logical role names to environment variable keys:

| Provider | Category | Required Roles | Optional Roles |
|----------|----------|---------------|----------------|
| Trello | pm | `api_key` → `TRELLO_API_KEY`, `token` → `TRELLO_TOKEN` | `api_secret` |
| JIRA | pm | `email` → `JIRA_EMAIL`, `api_token` → `JIRA_API_TOKEN` | `webhook_secret` |
| Linear | pm | `api_key` → `LINEAR_API_KEY` | `webhook_secret` → `LINEAR_WEBHOOK_SECRET` |
| GitHub | scm | `implementer_token` → `GITHUB_TOKEN_IMPLEMENTER`, `reviewer_token` → `GITHUB_TOKEN_REVIEWER` | `webhook_secret` |
| Sentry | alerting | `api_token` → `SENTRY_API_TOKEN` | `webhook_secret` |

## Provider Implementations

### Trello (`src/integrations/pm/trello/`, `src/pm/trello/`, `src/trello/`)

- `trelloManifest` declares the PM provider contract and registers with `pmProviderRegistry`
- `TrelloIntegration` implements the mirrored `PMIntegration`
- `TrelloPMProvider` implements `PMProvider` (card CRUD, comments, labels, checklists)
- `trelloClient` — Octokit-style client with AsyncLocalStorage credential scoping
- Media extraction from markdown in card descriptions/comments
- Status = list ID (cards grouped by lists)

### JIRA (`src/integrations/pm/jira/`, `src/pm/jira/`, `src/jira/`)

- `jiraManifest` declares the PM provider contract and registers with `pmProviderRegistry`
- `JiraIntegration` implements the mirrored `PMIntegration`
- `JiraPMProvider` implements `PMProvider` (issue CRUD, transitions, comments)
- `jiraClient` — wraps `jira.js` Version3Client with AsyncLocalStorage scoping
- ADF (Atlassian Document Format) ↔ markdown conversion (`src/pm/jira/adf.ts`)
- Status transitions via JIRA transition ID lookup
- Issue key extraction via regex: `[A-Z][A-Z0-9]+-\d+`

### Linear (`src/integrations/pm/linear/`, `src/pm/linear/`, `src/linear/`)

- `linearManifest` declares the PM provider contract and registers with `pmProviderRegistry`
- `LinearIntegration` implements the mirrored `PMIntegration`
- `LinearPMProvider` implements `PMProvider` (issue CRUD, comments, labels, state transitions)
- `linearClient` — GraphQL/REST client with AsyncLocalStorage credential scoping
- Status transitions via Linear state ID lookup
- Issue identifier extraction via regex: `[A-Z][A-Z0-9]*-\d+` (e.g. `TEAM-123`)
- Work item URL format: `https://linear.app/<org>/issue/<identifier>`

### GitHub (`src/github/`)

- `GitHubSCMIntegration` implements `SCMIntegration`
- `githubClient` — Octokit wrapper with `withGitHubToken()` AsyncLocalStorage scoping
- **Dual-persona model** (`src/github/personas.ts`):
  - **Implementer** — writes code, creates PRs (used by most agents)
  - **Reviewer** — reviews PRs, can approve or request changes (used by `review` agent)
  - `isCascadeBot(login)` — checks if a GitHub login belongs to either persona
  - `resolvePersonaIdentities()` — resolves both tokens to usernames (cached 60s per project)
- Loop prevention: `respond-to-review` only fires on reviewer's `changes_requested`; comment triggers skip @mentions from any known persona

### Sentry (`src/sentry/`)

- `SentryAlertingIntegration` implements `AlertingIntegration`
- `sentryClient` — REST API client with Bearer token auth
- Supports issue alerts, metric alerts, and issue lifecycle webhooks
- Config: `organizationSlug` stored in `project_integrations.config` JSONB

## PM Abstraction

`src/pm/`

### PMProvider interface

Lower-level data operations consumed by gadgets and lifecycle hooks:

```typescript
interface PMProvider {
  getWorkItem(id: string): Promise<WorkItem>;
  listWorkItems(filter?): Promise<WorkItem[]>;
  createWorkItem(config): Promise<WorkItem>;
  updateWorkItem(id, updates): Promise<WorkItem>;
  moveToStatus(id, status): Promise<void>;
  addComment(id, text): Promise<WorkItemComment>;
  getChecklists(id): Promise<Checklist[]>;
  addLabel(id, label): Promise<void>;
  removeLabel(id, label): Promise<void>;
  linkPR(id, prUrl): Promise<void>;
  // ... more operations
}
```

### PMRegistry

`src/pm/registry.ts` — backward-compatible PM-specific registry. Maps PM type to integration instance. Used by trigger handlers and gadgets that need PM operations.

### PM Lifecycle Manager

`src/pm/lifecycle.ts` — orchestrates card/issue state during agent execution:

- `prepareForAgent()` — add processing label, move to "In Progress"
- `handleSuccess()` — add processed label, move to "In Review", link PR
- `handleFailure()` — add error label, post error comment
- `cleanupProcessing()` — remove processing label

For the complete step-by-step guide to adding a new integration, see [`src/integrations/README.md`](../../src/integrations/README.md).
