# Configuration and Credentials

CASCADE stores all project configuration in PostgreSQL. There are no config files read at runtime — the database is the sole source of truth.

## Config Provider

`src/config/provider.ts`

The config provider loads project configuration from the database with in-memory caching.

### Loading functions

| Function | Lookup key | Returns |
|----------|-----------|---------|
| `loadConfig()` | All projects | `CascadeConfig` (all projects in org) |
| `loadProjectConfigByBoardId(boardId)` | Trello board ID | `{ project, config }` |
| `loadProjectConfigByRepo(repo)` | GitHub `owner/repo` | `{ project, config }` |
| `loadProjectConfigByJiraProjectKey(key)` | JIRA project key | `{ project, config }` |
| `loadProjectConfigByLinearTeamId(teamId)` | Linear team ID | `{ project, config }` |
| `loadProjectConfigByGitHubProjectsProjectId(id)` | GitHub Project node ID (`PVT_…`) | `{ project, config }` |
| `loadProjectConfigById(id)` | CASCADE project ID | `{ project, config }` |

### Caching

`src/config/configCache.ts` — in-memory cache with TTL populated at service startup. Caches:
- Full config object
- Per-project lookups by board ID, repo, JIRA key, Linear team ID
- Invalidated on config writes (via tRPC mutations)

## Config Schema

`src/config/schema.ts`

Project configuration is validated with Zod schemas. Key fields:

```typescript
interface ProjectConfig {
  id: string;
  orgId: string;
  name: string;
  repo?: string;                    // GitHub owner/repo
  baseBranch: string;               // default: 'main'
  branchPrefix: string;             // default: 'feature/'
  model: string;                    // LLM model identifier
  maxIterations: number;            // default: 50
  watchdogTimeoutMs: number;        // default: 30 min
  workItemBudgetUsd: number;        // default: $5
  progressModel: string;
  progressIntervalMinutes: number;  // default: 5
  agentEngine?: { default: string; overrides: Record<string, string> };
  engineSettings?: EngineSettings;
  agentEngineSettings?: Record<string, EngineSettings>;
  agentUpdateChannels?: Record<string, 'none' | 'scm-only' | 'pm-only' | 'both'>;  // per-agent posting gate; default 'both'
  runLinksEnabled: boolean;
  maxInFlightItems?: number;        // hard cap on TODO+IN_PROGRESS+IN_REVIEW; default 1
  setupTimeoutMs?: number;          // wall timeout (ms) for .cascade/setup.sh; null/0 = no limit (global worker timeout is the net)
  // ... PM config (trello/jira/linear), agent models, snapshot settings
}
```

**Run links.** When `runLinksEnabled` is `true`, agent comments carry a subtle dashboard
footer linking back to the run — `/runs/<id>` once a run row exists, or the work-item runs
page `/work-items/<projectId>/<workItemId>` posted at ack time before the worker has committed
the run row. Because such a link can be opened before the run row exists, the work-item runs
page renders a transient "Run is starting…" state and keeps polling through a bounded grace
window rather than flashing a terminal "No runs found".

### Agent update channel

`src/config/updateChannel.ts`

Each agent type has an optional **`updateChannel`** that gates *where* the agent
posts **communication-only** status updates — independently for the **PM**
(work-item comments) and **SCM** (PR comments / reviews) surfaces. It is a
per-agent override stored in the `agent_configs.update_channel` column (one row
per `(projectId, agentType)`), surfaced on `ProjectConfig.agentUpdateChannels`
by the config mapper (`buildAgentMaps`) and read at runtime via
`resolveUpdateChannel(project, agentType)`.

| `updateChannel` | PM posting | SCM posting |
|---|:---:|:---:|
| `none` | ❌ | ❌ |
| `pm-only` | ✅ | ❌ |
| `scm-only` | ❌ | ✅ |
| `both` (default) | ✅ | ✅ |

A `NULL` / absent column — or any value the config mapper does not recognize —
inherits the default **`both`** (post everywhere, the historical behavior). The
mapper validates the stored string against the channel catalog
(`UPDATE_CHANNELS`) so a stale or invalid value never breaks config loading. The
channel is **communication-only**: it suppresses acks, progress updates,
lifecycle status comments, agent summaries, and the agent's own comment/review
tools, but never PR creation, status moves, label writes, checklist sync, PR
linking, friction reports, or the "eyes" reaction. See
[`04-agent-system.md`](./04-agent-system.md#update-channel-posting-surfaces) for
the full gated-vs-not-gated surface map.

### PM workflow slots

PM provider config maps CASCADE lifecycle concepts onto provider-native lists or statuses. The friction-reporting slot is optional but recognized consistently across providers:

| Provider | Config key | Meaning |
|---|---|---|
| Trello | `lists.friction` | Trello list ID where friction report cards are created and left |
| JIRA | `statuses.friction` | JIRA status name/ID applied after the issue is created in `projectKey` |
| Linear | `statuses.friction` | Linear workflow state UUID applied after the issue is created in `teamId` |

If the slot is not configured, `ReportFriction` records the report in the sidecar and returns a non-fatal `queued_slot_missing` result with operator guidance. No run should fail solely because the friction slot is missing.

Backlog selection and work-item creation use different native concepts:

| Provider | Backlog selection | Work-item creation |
|----------|-------------------|--------------------|
| Trello | `lists.backlog` list ID | same backlog list ID |
| JIRA | `statuses.backlog` status name/ID | `projectKey` |
| Linear | `statuses.backlog` workflow state UUID | `teamId` |

For Linear, `teamId` is not a backlog state. It is the container used when creating or searching issues, and unfiltered team listing may include unmapped workflow states such as Ideas. Pipeline snapshot and backlog-manager paths use status-aware listing (`ListWorkItems --status backlog`) so only the configured `linear.statuses.backlog` state is eligible for selection.

Backlog-manager receives pipeline state through the required `pipelineSnapshot`
context step, which emits one structured `PipelineSnapshotSummary` JSON
injection. The JSON includes provider-source status counts, active pipeline
count, backlog item order, `itemsById`, comments, checklists, labels,
descriptions, attachments/media references, dependency signals, and provider
errors. The legacy markdown `PipelineSnapshot` context is intentionally not
emitted. If all backlog items appear blocked, backlog-manager posts the blocked
backlog comment only on the first BACKLOG item in `statuses.backlog.itemIds`
provider order; when BACKLOG is empty it exits without posting.

`maxInFlightItems` is enforced at two points: (a) the `backlog-manager` chain
gates (won't auto-pull from BACKLOG when at capacity) and (b) the PM
`status-changed` triggers (won't fire `implementation` when a card is moved
into TODO past the cap). PM router adapters must dispatch inside
`withPMScopeForDispatch(fullProject, dispatch)` so this gate can resolve the
active PM provider; if that scope is missing the gate fails closed and captures
Sentry under `pipeline_capacity_gate_no_pm_provider`. See
`src/triggers/shared/pipeline-capacity-gate.ts`.

### Custom workflow status mappings

Operators can register custom workflow statuses (e.g. `prd`, `story`,
`phased-plan`) through `cascade workflow-statuses create` or the superadmin
`workflowStatuses.create` tRPC mutation. The definition itself — `key`,
`label`, optional dispatch `agentType`, `sortOrder` — lives in the
`workflow_status_definitions` table alongside the built-in catalog
(`BUILTIN_WORKFLOW_STATUSES` in `src/workflow/statusDefinitions.ts`). See
[`04-agent-system.md`](./04-agent-system.md#custom-workflow-statuses-across-pm-providers)
for the dispatch contract.

The provider-native mapping for each custom key is stored in
`project_integrations.config` under the same key shape used for built-in
slots — there is no separate side table for custom keys:

| Provider | Custom key location | Value shape |
|---|---|---|
| Trello | `lists.<customKey>` | Trello list ID |
| JIRA | `statuses.<customKey>` | JIRA status name |
| Linear | `statuses.<customKey>` | Linear workflow state UUID |

For example, after `cascade workflow-statuses create --key prd --label PRD
--agent-type prd`, a Trello project might persist `lists.prd: "5f8a..."`
in the integration config, while the equivalent JIRA project persists
`statuses.prd: "PRD Ready"` and the Linear project persists
`statuses.prd: "f3c1-..."`. The lifecycle config resolvers in
`src/pm/trello/integration.ts`, `src/pm/jira/integration.ts`, and
`src/pm/linear/integration.ts` spread the full `lists` / `statuses` record so
custom keys survive normalization and reach the `moveOnPrepare` /
`moveOnSuccess` lifecycle hooks for custom agents.

A custom mapped status only dispatches an agent when its definition has a
non-null `agentType` AND the project has an enabled `pm:status-changed`
trigger config for that agent. The PM wizard's save path auto-creates the
missing trigger config when the operator maps a dispatch-capable custom
status, via `buildMissingStatusTriggerConfigs`. Custom statuses with
`agentType: null` render and save normally but the trigger handlers return
`null` instead of dispatching.

## Credential Resolution

CASCADE uses a two-tier credential resolution system, selecting the appropriate resolver based on execution context.

### Router / Dashboard context

Uses `DbCredentialResolver` — reads credentials from the `project_credentials` database table:

```typescript
getIntegrationCredential(projectId, category, role)  // e.g., ('proj1', 'pm', 'api_key')
getAllProjectCredentials(projectId)                     // All credentials as env-var-key map
```

### Worker context

Uses `EnvCredentialResolver` — reads from `process.env` (pre-loaded by the router's `worker-env.ts`):

The router builds the worker's environment by:
1. Loading all project credentials from the database
2. Setting them as individual env vars on the Docker container
3. Setting `CASCADE_CREDENTIAL_KEYS` with a comma-separated list of the env var names

When the worker starts, it detects `CASCADE_CREDENTIAL_KEYS` and uses `EnvCredentialResolver` instead of hitting the database.

### Auto-selection

```typescript
// If CASCADE_CREDENTIAL_KEYS is set → worker context (env resolver)
// Otherwise → router/dashboard context (DB resolver)
```

### AsyncLocalStorage scoping

Provider clients use `AsyncLocalStorage` for per-request credential isolation:

```typescript
// GitHub
await withGitHubToken(token, async () => {
  // All GitHub API calls in this scope use this token
});

// Trello
await withTrelloCredentials({ apiKey, token }, async () => {
  // All Trello API calls use these credentials
});

// JIRA
await withJiraCredentials({ email, apiToken, baseUrl, authType }, async () => {
  // All JIRA API calls use these credentials.
  // `authType` ('basic' | 'scoped', optional) selects the REST v3 host
  // via the shared resolveJiraApiBaseUrl() resolver — see below.
});

// Linear
await withLinearCredentials({ apiKey }, async () => {
  // All Linear API calls use these credentials
});
```

### JIRA authentication modes (scoped tokens)

`src/jira/api-host.ts`, `src/jira/authType.ts`

JIRA supports classic unscoped site tokens **and** Atlassian API tokens with scopes. The mode is selected by the optional `authType` field on the JIRA integration config (`project_integrations.config`) — a non-secret connection setting that mirrors `baseUrl`, **not** a credential role. Values: `'basic'` (or absent) and `'scoped'`. Both modes authenticate with **HTTP Basic** (`email:api_token`); `authType` selects the REST v3 *host*, not the auth scheme.

Every REST v3 call site routes through one shared resolver, `resolveJiraApiBaseUrl(creds)` — the JIRA analogue of the shared auth-header helper:

| `authType` | REST v3 host | Notes |
|---|---|---|
| `basic` / absent | tenant **site URL** (`creds.baseUrl`, e.g. `https://acme.atlassian.net`) | Classic behavior, unchanged. Every pre-existing config maps here. |
| `scoped` | Atlassian **gateway** (`https://api.atlassian.com/ex/jira/{cloudId}`) | `cloudId` is resolved from `${baseUrl}/_edge/tenant_info` (always the site URL, never the gateway) with the same Basic scoped token, cached per `baseUrl`. Direct site REST v3 calls can fail under scoped tokens, so the gateway is the supported path. |

The worker/CLI credential scope carries the mode across process boundaries via the `CASCADE_JIRA_AUTH_TYPE` env var (injected by `secretBuilder.augmentProjectSecrets`); `normalizeJiraAuthType` maps absent/unknown values back to `'basic'` so existing projects keep working. `accessible-resources` is intentionally **not** used to discover `cloudId` — it is OAuth 2.0 / 3LO guidance and returns `401` for scoped API tokens.

**Required scopes.** Read/write Jira work (classic OAuth `read:jira-work` + `write:jira-work`). Programmatic webhook management additionally needs webhook scopes — classic OAuth `manage:jira-webhook`, or granular `read:field:jira` + `read:project:jira` + `write:webhook:jira`. A scoped token without webhook scopes (or a non-app caller) gets `401`/`403` from `/rest/api/3/webhook`; the wizard then surfaces an actionable message pointing at manual webhook registration.

**Known limitation — ack reactions.** The "eyes" acknowledgment reaction uses Jira's internal `/rest/reactions/1.0/` API, which lives only on the tenant site URL and is not confirmed on the scoped gateway. Under `scoped` auth the reaction degrades quietly (one log line, then skip) — it is best-effort and never fails a run. Comments, status transitions, and label writes are unaffected.

## Credential Encryption

`src/db/crypto.ts`

When `CREDENTIAL_MASTER_KEY` is set (64-char hex string = 32-byte AES-256 key), credentials are encrypted at rest.

- **Algorithm**: AES-256-GCM with 12-byte random IV and 16-byte auth tag
- **AAD**: `projectId` (additional authenticated data)
- **Storage format**: `enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>`
- **Transparent**: `writeProjectCredential()` encrypts before DB write; read functions decrypt automatically
- **Opt-in**: Without the env var, credentials are stored and read as plaintext

### Key management

```bash
npm run credentials:generate-key     # Generate new 32-byte key
npm run credentials:encrypt           # Encrypt all existing plaintext credentials
npm run credentials:decrypt           # Rollback to plaintext
npm run credentials:rotate-key        # Re-encrypt with CREDENTIAL_MASTER_KEY_NEW
```

## Integration Roles

`src/config/integrationRoles.ts`

Maps provider → category → credential roles. Each role maps a logical name to an env var key:

```typescript
registerCredentialRoles('trello', 'pm', [
  { role: 'api_key', label: 'API Key', envVarKey: 'TRELLO_API_KEY' },
  { role: 'token',   label: 'Token',   envVarKey: 'TRELLO_TOKEN' },
]);
```

`hasIntegration()` returns `true` only if all non-optional roles have values stored.

## Engine Settings

`src/config/engineSettings.ts`

Per-engine configuration schemas registered dynamically at bootstrap. Settings are merged at execution time:
1. Project-level `engineSettings` (base)
2. Agent-config-level `agentEngineSettings[agentType]` (override)

Each engine optionally provides a `getSettingsSchema()` method that returns a Zod schema, registered via `registerEngineSettingsSchema()`.
