# Integration Layer

CASCADE uses a unified integration abstraction so that infrastructure code (router, worker, webhook handlers) never branches on provider type. Every PM, SCM, and alerting provider is a class implementing `IntegrationModule`, registered into a singleton `IntegrationRegistry` at bootstrap.

## IntegrationModule

`src/integrations/types.ts`

The base contract for all integrations:

```typescript
interface IntegrationModule {
  readonly type: string;              // 'trello', 'jira', 'github', 'sentry'
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

`withCredentials()` uses `AsyncLocalStorage` to set provider-specific env vars for the duration of a callback, then restores the original values. This provides per-request credential isolation without global state mutation.

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

### PMIntegration

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

`src/integrations/bootstrap.ts`

Single, idempotent registration point for all four built-in integrations. Safe to import from router, worker, and dashboard — it does not pull in the agent execution pipeline or template files.

```
TrelloIntegration   → integrationRegistry + pmRegistry
JiraIntegration     → integrationRegistry + pmRegistry
GitHubSCMIntegration → integrationRegistry
SentryAlertingIntegration → integrationRegistry
```

## Credential Roles

`src/config/integrationRoles.ts`

Each provider declares its credential roles — the mapping from logical role names to environment variable keys:

| Provider | Category | Required Roles | Optional Roles |
|----------|----------|---------------|----------------|
| Trello | pm | `api_key` → `TRELLO_API_KEY`, `token` → `TRELLO_TOKEN` | `api_secret` |
| JIRA | pm | `email` → `JIRA_EMAIL`, `api_token` → `JIRA_API_TOKEN` | `webhook_secret` |
| GitHub | scm | `implementer_token` → `GITHUB_TOKEN_IMPLEMENTER`, `reviewer_token` → `GITHUB_TOKEN_REVIEWER` | `webhook_secret` |
| Sentry | alerting | `api_token` → `SENTRY_API_TOKEN` | `webhook_secret` |

## Provider Implementations

### Trello (`src/pm/trello/`, `src/trello/`)

- `TrelloIntegration` implements `PMIntegration`
- `TrelloPMProvider` implements `PMProvider` (card CRUD, comments, labels, checklists)
- `trelloClient` — Octokit-style client with AsyncLocalStorage credential scoping
- Media extraction from markdown in card descriptions/comments
- Status = list ID (cards grouped by lists)

### JIRA (`src/pm/jira/`, `src/jira/`)

- `JiraIntegration` implements `PMIntegration`
- `JiraPMProvider` implements `PMProvider` (issue CRUD, transitions, comments)
- `jiraClient` — wraps `jira.js` Version3Client with AsyncLocalStorage scoping
- ADF (Atlassian Document Format) ↔ markdown conversion (`src/pm/jira/adf.ts`)
- Status transitions via JIRA transition ID lookup
- Issue key extraction via regex: `[A-Z][A-Z0-9]+-\d+`

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
