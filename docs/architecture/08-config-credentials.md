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
| `loadProjectConfigById(id)` | CASCADE project ID | `{ project, config }` |

### Caching

`src/config/configCache.ts` — in-memory cache with TTL populated at service startup. Caches:
- Full config object
- Per-project lookups by board ID, repo, JIRA key
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
  runLinksEnabled: boolean;
  maxInFlightItems?: number;
  // ... PM config (trello/jira), agent models, snapshot settings
}
```

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
await withJiraCredentials({ email, apiToken, baseUrl }, async () => {
  // All JIRA API calls use these credentials
});
```

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
