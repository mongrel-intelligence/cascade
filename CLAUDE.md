# CASCADE - PM-to-Code Automation Platform

## Quick Start

```bash
npm install
cd web && npm install && cd ..
# Start Redis (required for router/BullMQ):
#   macOS: brew install redis && brew services start redis
#   Linux: apt-get install redis-server && service redis-server start
# The .cascade/setup.sh script handles this automatically.
npm run dev          # Router (webhook receiver, requires Redis)
npm run dev:web      # Dashboard frontend (separate terminal)
```

## Architecture

CASCADE runs as three services (no monolithic server mode):

1. **Router** (`src/router/index.ts`) — receives webhooks, enqueues jobs to Redis via BullMQ
2. **Worker** (`src/worker-entry.ts`) — processes one job per container, exits when done
3. **Dashboard** (`src/dashboard.ts`) — API + tRPC for web UI and CLI

### Trigger System

The extensible trigger system routes events to agents:

```
Trello/JIRA/Sentry/GitHub Webhook → Router → Redis/BullMQ → Worker → TriggerRegistry → Agent → Code Changes → PR
```

- `src/router/` - Webhook receiver (enqueues jobs to Redis)
- `src/webhook/` - Shared webhook handler factory, parsers, and logging
- `src/triggers/` - Event handlers (Trello/JIRA card moves, labels, GitHub PRs, Sentry alerts)
- `src/agents/` - AI agents (splitting, planning, implementation, review, debug, alerting, backlog-manager, resolve-conflicts)
- `src/gadgets/` - Tools agents can use (PM/SCM/alerting operations, Tmux, Todo, file system)

### Multi-Project Support

Projects are configured in the PostgreSQL database (`projects` table). Each project has its own PM board, GitHub repo, and optional per-project credentials.

## Development

### Testing

> **For a full catalog of test helpers, factory functions, and mock objects**, see [`tests/README.md`](tests/README.md).

```bash
npm test                 # Run unit tests (all 4 unit projects)
npm run test:unit        # Alias for npm test
npm run test:integration # Run integration tests (requires DB — see below)
npm run test:all         # Run unit + integration tests together
npm run test:coverage    # Coverage report (unit tests)
npm run test:watch       # Watch mode (unit tests)
```

> **Do not use `npm test -- --project integration`** — it _adds_ the integration project on top of the hardcoded unit project flags, running all 5 projects instead of filtering. Use `npm run test:integration` instead.

> **Agent tip — integration test runs are slow (~4 min for full suite).** When a specific
> test file is failing, always target it directly:
> ```bash
> # Run one file (seconds) instead of the full suite (4+ min):
> TEST_DATABASE_URL=... npx vitest run --project integration tests/integration/<file>.test.ts
> ```
> Run the full suite only to confirm all tests pass before pushing.

Integration tests require a PostgreSQL database. The setup:
1. **Auto-creates** the database when `TEST_DATABASE_URL` is set and postgres is reachable
   but the database doesn't exist yet (connects to `postgres` admin DB and creates it)
2. **Auto-finds** an existing DB via (in order): `TEST_DATABASE_URL` env var →
   `TEST_DATABASE_URL` in `.cascade/env` → Docker Compose at `127.0.0.1:5433` →
   container IP of `cascade-postgres-test`
3. **Silently skips** all integration tests if no database is reachable at all

On developer machines (Docker):
```bash
npm run test:db:up        # start ephemeral postgres on :5433 (one-time per session)
npm run test:integration  # tests auto-find it, run migrations, clean up
```

In worker/agent environments (local postgres already running):
```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cascade_test \
  npm run test:integration   # setup auto-creates cascade_test DB if missing
```

### Linting

```bash
npm run lint             # Check
npm run lint:fix         # Fix
npm run typecheck        # Type check
```

### Zod Version Policy

Both the root workspace and the `web/` workspace **must use the same Zod major version**. Currently both are aligned on `zod@^3.25.0` (the bridge version that ships v3 and v4 dual exports).

- **Root (`package.json`)**: `"zod": "^3.25.0"` — backend uses the v3 API surface
- **Web (`web/package.json`)**: `"zod": "^3.25.0"` — frontend also uses v3 API surface

**Why this matters**: `web/tsconfig.json` includes `../src/api/**/*` and `../src/db/**/*` (backend files that import from `zod`). If the two workspaces resolve different Zod major versions, `z.infer<>` can silently compute different types for the same schema in backend vs. frontend compilation contexts.

**When upgrading Zod**: Both workspaces must be bumped to the same new version together. A full migration to the v4 API would also require auditing `z.ZodType` usage (renamed class hierarchy in v4), `z.ZodIssueCode` (slightly different enum), and `.default()` behavior (eagerly evaluated in v4).

### Git Hooks

Lefthook runs pre-commit (lint, typecheck) and pre-push (unit tests, integration tests) hooks automatically. The pre-push hook auto-starts an ephemeral PostgreSQL via Docker (`npm run test:db:up`) for integration tests — Docker must be running.

## Key Directories

- `src/router/` - Router entry point (webhook receiver, enqueues to Redis)
- `src/webhook/` - Shared webhook handler factory, parsers, and logging helpers
- `src/config/` - Configuration provider, caching, Zod schemas
- `src/db/` - Database client, Drizzle schema, repositories
- `src/integrations/` - **Unified integration interfaces and registry** (see below)
- `src/triggers/` - Extensible trigger system (Trello, JIRA, GitHub, Sentry)
- `src/agents/` - AI agent implementations
- `src/gadgets/` - Custom gadgets (PM, SCM, alerting, Tmux, Todo, file system)
- `src/cli/dashboard/` - Dashboard CLI commands (`cascade` binary)
- `src/cli/alerting/` - Alerting gadget commands (`cascade-tools` binary)
- `src/api/` - Dashboard API (tRPC routers, auth handlers)
- `src/github/` - GitHub client, dual-persona model (personas.ts)
- `src/trello/` - Trello API client
- `src/jira/` - JIRA API client
- `src/sentry/` - Sentry API client and integration
- `src/utils/` - Utilities (logging, repo cloning, lifecycle)
- `web/` - Dashboard frontend (React 19, Vite, Tailwind v4, TanStack Router)
- `tools/` - Developer scripts (session debugging, DB seeding, secrets management)

## Integration Architecture

CASCADE uses a unified integration abstraction layer in `src/integrations/`. Every PM, SCM,
and alerting provider is a class implementing `IntegrationModule` (and optionally a
category-specific sub-interface). Modules register into `IntegrationRegistry` at bootstrap time.
Infrastructure (router, worker, webhook handler) looks up integrations by `type` string with no
provider-specific branching.

### Categories

| Category | Interface | Example providers |
|----------|-----------|-------------------|
| `pm` | `PMIntegration` (extends `IntegrationModule`) | Trello, JIRA |
| `scm` | `SCMIntegration` (extends `IntegrationModule`) | GitHub |
| `alerting` | `AlertingIntegration` (extends `IntegrationModule`) | Sentry |

### IntegrationModule (base contract)

All integrations implement four required members:

- `type` — unique provider string (e.g. `'trello'`, `'github'`, `'sentry'`)
- `category` — which capability group (`'pm'`, `'scm'`, or `'alerting'`)
- `withCredentials(projectId, fn)` — set env vars for the project, call `fn`, restore on exit
- `hasIntegration(projectId)` — returns `true` if all required credentials are present

Optional webhook methods (`parseWebhookPayload`, `isSelfAuthored`, `lookupProject`,
`extractWorkItemId`) are implemented by providers that receive webhooks.

### IntegrationRegistry

`integrationRegistry` (singleton in `src/integrations/registry.ts`) is populated once at
bootstrap (`src/integrations/bootstrap.ts`). Callers use:

```typescript
integrationRegistry.get('github')           // throws if missing
integrationRegistry.getOrNull('sentry')     // null if missing
integrationRegistry.getByCategory('pm')     // all PM integrations
```

PM integrations are registered in `pmRegistry` via `src/integrations/bootstrap.ts` (the single canonical registration point).

### Credential roles

Each provider declares its credential roles in `src/config/integrationRoles.ts` via
`registerCredentialRoles(provider, category, roles)`. Roles map a logical `role` name to an
env-var key (e.g. `api_key` → `TRELLO_API_KEY`). Roles without `optional: true` are required
for `hasIntegration()` to return `true`.

### Bootstrap

`src/integrations/bootstrap.ts` is the single registration point for all four built-in
integrations. It is safe to import from both the router and worker — it does not pull in the
agent execution pipeline or template files.

### Adding a new integration

See [`src/integrations/README.md`](src/integrations/README.md) for the complete step-by-step
guide covering all extension points: interface implementation, credential roles, bootstrap
registration, webhook routes, router adapters, trigger handlers, and gadgets.

## Environment Variables

Required:
- `DATABASE_URL` - PostgreSQL connection string (e.g., `postgresql://user:pass@host:5432/cascade`)
- `REDIS_URL` - Redis connection string for BullMQ job queue (router + worker). Defaults to `redis://localhost:6379`. Run `.cascade/setup.sh` to install and start Redis locally.

Optional (infrastructure):
- `PORT` - Server port (default: 3000)
- `LOG_LEVEL` - Logging level (default: info)
- `DATABASE_SSL` - Set to `false` to disable SSL for local PostgreSQL (default: enabled with certificate validation)
- `DATABASE_CA_CERT` - Path to a PEM-encoded CA certificate file for managed databases that use a private CA (e.g., AWS RDS, Azure Database, GCP Cloud SQL). When set, the certificate is read and passed as the `ca` option to `pg.Pool`, enabling TLS certificate validation against the specified CA. Example: `DATABASE_CA_CERT=/etc/ssl/certs/rds-ca.pem`
- `CLAUDE_CODE_OAUTH_TOKEN` - For Claude Code engine (subscription auth)
- `CREDENTIAL_MASTER_KEY` - 64-char hex string (32-byte AES-256 key) for encrypting credentials at rest. Generate with `npm run credentials:generate-key`. When set, all new/updated credentials are encrypted automatically; existing plaintext credentials continue to work.
- `WEBHOOK_CALLBACK_BASE_URL` - Base URL for webhook callbacks (e.g., `https://cascade.example.com`). Used by `tools/setup-webhooks.ts` and the `cascade webhooks create` CLI command to construct the full webhook URL.
- `GITHUB_WEBHOOK_SECRET` - Optional HMAC secret for GitHub webhook signature verification. When set as an integration credential (`webhook_secret` role on the GitHub SCM integration), all newly created GitHub webhooks will include the secret so GitHub signs each delivery. The router then verifies the `X-Hub-Signature-256` header on incoming payloads.
- `SENTRY_DSN` - Sentry DSN for error monitoring (router + worker)
- `SENTRY_ENVIRONMENT` - Sentry environment tag (default: NODE_ENV or 'production')
- `SENTRY_RELEASE` - Release identifier for source maps (e.g., git SHA)
- `SENTRY_TRACES_SAMPLE_RATE` - Trace sampling rate 0.0-1.0 (default: 0.1)

**Project credentials** (`GITHUB_TOKEN_IMPLEMENTER`, `GITHUB_TOKEN_REVIEWER`, `TRELLO_API_KEY`, `TRELLO_TOKEN`, LLM API keys) are stored in the `project_credentials` table — project-scoped, encrypted at rest when `CREDENTIAL_MASTER_KEY` is set. All credentials (integration tokens and LLM keys) use the same `project_credentials` table keyed by `(projectId, envVarKey)`. There is no env var fallback — the database is the sole source of truth for project-scoped secrets.

## Database Configuration

CASCADE stores all project configuration in PostgreSQL. The `config/projects.json` file is only used by `npm run db:seed` (initial seeding) — it is not read at runtime.

### Schema

- `organizations` - Organization definitions (multi-tenant support)
- `projects` - Per-project config (repo, base branch, budget, engine, and per-project overrides for model, iterations, timeouts, progress model/interval, `squint_db_url`, `run_links_enabled`, `max_in_flight_items`)
- `project_integrations` - Integration configs per project with `category` (pm/scm), `provider` (trello/jira/github), `config` JSONB, and `triggers` JSONB. One PM + one SCM per project (enforced by unique constraint)
- `project_credentials` - Project-scoped credentials keyed by `(projectId, envVarKey)`. Stores all credential types (GitHub tokens, Trello keys, JIRA tokens, LLM API keys). Encrypted at rest when `CREDENTIAL_MASTER_KEY` is set
- `agent_configs` - Per-agent-type overrides (model, iterations, engine, `agent_engine_settings`, max_concurrency, `system_prompt`, `task_prompt`), project-scoped only (`project_id NOT NULL`)
- `agent_definitions` - Agent YAML definitions (built-in and custom). Each row stores the full definition JSONB, keyed by `agent_type`
- `agent_trigger_configs` - Configured trigger events per project/agent pair (replaces legacy `project_integrations.triggers`)
- `prompt_partials` - Org-scoped partial prompt templates for customizing agent prompts (`.eta` partials)
- `pr_work_items` - Maps PRs to work items (PR number + repo → work item ID/URL) for run-link display
- `webhook_logs` - Raw webhook payloads for debugging (source, headers, body, status, decision reason)
- `users` - Dashboard users (email, bcrypt password hash, org-scoped)
- `sessions` - Session tokens for cookie-based auth (30-day expiry)

### Database Scripts

```bash
npm run db:generate            # Generate migration SQL from schema changes
npm run db:migrate             # Apply pending migrations
npm run db:push                # Push schema directly (dev only)
npm run db:studio              # Open Drizzle Studio
npm run db:seed -- --org <id>  # Seed DB from config/projects.json into an org
npm run db:bootstrap-journal   # Bootstrap migration journal (one-time setup for existing DBs)
```

### Migration Workflow

Migrations are hand-written SQL files in `src/db/migrations/` tracked by drizzle-kit's journal (`meta/_journal.json`). When adding a new migration:

1. Create `src/db/migrations/NNNN_description.sql`
2. Add a corresponding entry to `src/db/migrations/meta/_journal.json` with a unique `when` timestamp (ms since epoch) and `tag` matching the filename without `.sql`
3. Run `npm run db:migrate` to apply

For databases initially set up with `drizzle-kit push` (no migration journal), run `npm run db:bootstrap-journal` once to register existing migrations in the `drizzle.__drizzle_migrations` tracking table.

### Credential Encryption at Rest

All credentials are project-scoped and stored in the `project_credentials` table keyed by `(projectId, envVarKey)`. Credentials are encrypted using AES-256-GCM when `CREDENTIAL_MASTER_KEY` is set. Encryption is transparent — all callers (config provider, tRPC, CLI, tools) are unaffected.

- **Algorithm**: AES-256-GCM with 12-byte random IV, 16-byte auth tag, `projectId` as AAD
- **Storage format**: `enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>` in the existing `value` TEXT column
- **Automatic encryption**: `writeProjectCredential()` encrypts before DB write
- **Automatic decryption**: All resolve/list functions decrypt on read
- **Opt-in**: Without the env var, system works identically to plaintext (zero behavior change)

```bash
npm run credentials:generate-key            # Generate a new 32-byte hex key
npm run credentials:encrypt -- --dry-run    # Preview migration (plaintext → encrypted)
npm run credentials:encrypt                 # Encrypt all existing plaintext credentials
npm run credentials:decrypt                 # Rollback: decrypt all back to plaintext
npm run credentials:rotate-key              # Re-encrypt with CREDENTIAL_MASTER_KEY_NEW
```

**Key rotation** requires both `CREDENTIAL_MASTER_KEY` (current) and `CREDENTIAL_MASTER_KEY_NEW` (new). After rotation, update the env var to the new key and restart.

### GitHub Dual-Persona Model

CASCADE uses two dedicated GitHub bot accounts per project to prevent feedback loops:

- **Implementer** (`GITHUB_TOKEN_IMPLEMENTER`) — writes code, creates PRs, responds to review comments
  - Agents: `implementation`, `respond-to-review`, `respond-to-ci`, `respond-to-pr-comment`, `splitting`, `planning`, `respond-to-planning-comment`, `debug`, `alerting`, `backlog-manager`, `resolve-conflicts`
- **Reviewer** (`GITHUB_TOKEN_REVIEWER`) — reviews PRs, can approve or request changes
  - Agents: `review`

Both tokens are **required** for each project. Store them via the dashboard (Project Settings > Credentials tab) or CLI:

```bash
cascade projects credentials-set <project-id> --key GITHUB_TOKEN_IMPLEMENTER --value ghp_aaa...
cascade projects credentials-set <project-id> --key GITHUB_TOKEN_REVIEWER --value ghp_bbb...
```

**Bot detection**: Both persona usernames are resolved at first use and cached. Trigger handlers use `isCascadeBot(login)` to check if an event came from either persona, preventing self-triggered loops.

**Loop prevention rules**:
- `respond-to-review` ONLY fires when the **reviewer** persona submits a `changes_requested` review
- `respond-to-pr-comment` skips @mentions from **any** known persona
- `check-suite-success` checks reviews from the **reviewer** persona specifically

### Webhook Signature Verification

CASCADE supports opt-in HMAC-SHA256 signature verification for GitHub webhook payloads.

1. Store a `GITHUB_WEBHOOK_SECRET` credential as a project credential:
   ```bash
   cascade projects credentials-set <project-id> --key GITHUB_WEBHOOK_SECRET --value <random-secret>
   ```
2. Create (or recreate) the GitHub webhook — CASCADE will include the secret automatically:
   ```bash
   cascade webhooks create <project-id> [--callback-url URL]
   # or via the setup tool:
   npx tsx tools/setup-webhooks.ts create <project-id> <callback-base-url>
   ```
3. GitHub signs every delivery with `X-Hub-Signature-256`; the CASCADE router verifies it before processing.

If no `webhook_secret` credential is configured, webhook creation works exactly as before (no secret, no signature verification). Existing webhooks without a secret continue to work unaffected.

### Integration Credential Resolution

Integration credentials are resolved by `(projectId, category, role)`:

```typescript
// Get a specific integration credential
const trelloKey = await getIntegrationCredential(projectId, 'pm', 'api_key');

// Get all integration credentials + org defaults as flat env-var-key map (for worker environments)
const allCreds = await getAllProjectCredentials(projectId);

// Non-integration org-scoped credentials (LLM API keys)
const openrouterKey = await getOrgCredential(projectId, 'OPENROUTER_API_KEY');
```

Role definitions and env-var-key mappings are in `src/config/integrationRoles.ts`.

### Agent Trigger Configuration

Triggers define which events activate which agents. Configuration is stored in the `agent_trigger_configs` table and managed via the unified `trigger-set` command.

#### Trigger Format

Triggers use a category-prefixed event format: `{category}:{event-name}`
- PM triggers: `pm:status-changed`, `pm:label-added`
- SCM triggers: `scm:check-suite-success`, `scm:check-suite-failure`, `scm:pr-review-submitted`
- Alerting triggers: `alerting:issue-created`, `alerting:metric-alert`

#### Setting Triggers

```bash
# Discover available triggers for an agent
cascade projects trigger-discover --agent review

# List configured triggers for a project
cascade projects trigger-list <project-id>

# Configure a trigger (unified command)
cascade projects trigger-set <project-id> --agent review --event scm:check-suite-success --enable
cascade projects trigger-set <project-id> --agent review --event scm:check-suite-success --params '{"authorMode":"own"}'

# Enable implementation trigger for PM status change
cascade projects trigger-set <project-id> --agent implementation --event pm:status-changed --enable
```

In the **Agent Configs** tab, each agent shows toggles for its supported triggers. Triggers with parameters (like `authorMode` for review) show additional input fields when enabled.

When merging to `dev` or `main`, legacy trigger configs from `project_integrations.triggers` are automatically migrated to the new `agent_trigger_configs` table. The migration is idempotent.

### Review Agent Trigger Modes

| Event | Description |
|-------|-------------|
| `scm:check-suite-success` | Trigger review when CI passes (use `authorMode` parameter: `own` or `external`) |
| `scm:review-requested` | Trigger review when a CASCADE persona is explicitly requested as reviewer |
| `scm:pr-opened` | Trigger review when a PR is opened |

```bash
# Enable review for implementer PRs only (most common)
cascade projects trigger-set <project-id> --agent review --event scm:check-suite-success --enable --params '{"authorMode":"own"}'

# Enable review when explicitly requested
cascade projects trigger-set <project-id> --agent review --event scm:review-requested --enable
```

### PM Agent Trigger Modes

| Event | Providers | Description |
|-------|-----------|-------------|
| `pm:status-changed` | Trello, JIRA | Trigger when card/issue moves to agent's target status |
| `pm:label-added` | All | Trigger when Ready to Process label is added |

```bash
cascade projects trigger-set <project-id> --agent implementation --event pm:status-changed --enable
cascade projects trigger-set <project-id> --agent splitting --event pm:label-added --enable
```

## Claude Code Engine

CASCADE uses the Claude Code SDK as the default agent engine. Configure per-project via the CLI or dashboard:

```bash
cascade projects update <project-id> --agent-engine claude-code

# Or override per agent type:
cascade agents create --agent-type implementation --project-id <project-id> --engine claude-code
```

### Authentication

**Claude Max Subscription via `CLAUDE_CODE_OAUTH_TOKEN`:**

1. Install Claude Code CLI: `npm install -g @anthropic-ai/claude-code`
2. Authenticate: `claude login` -> select "Log in with your subscription account"
3. Generate a token: `claude setup-token`
4. Set `CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...` in your environment.

CASCADE creates `~/.claude.json` with `{"hasCompletedOnboarding": true}` to skip interactive onboarding in headless environments.

**Docker verification test:**
```bash
bash tests/docker/claude-code-auth/run-test.sh
```

## Codex Engine

CASCADE supports OpenAI's Codex CLI as an alternative agent engine:

```bash
cascade projects update <project-id> --agent-engine codex
```

**API key (`OPENAI_API_KEY`):** Store as an org-scoped credential. No extra setup needed.

**Subscription (ChatGPT Plus/Pro via `CODEX_AUTH_JSON`):**

```bash
# 1. On a machine with a browser:
codex login

# 2. Store the auth token in CASCADE:
cascade projects credentials-set <project-id> \
  --key CODEX_AUTH_JSON \
  --value "$(cat ~/.codex/auth.json)" \
  --name "Codex Subscription Auth"

# 3. Set the engine:
cascade projects update <project-id> --agent-engine codex
```

CASCADE writes `~/.codex/auth.json` before each run and captures any post-run token refreshes back to the database automatically.

## OpenCode Engine

CASCADE supports the OpenCode engine as an alternative:

```bash
cascade projects update <project-id> --agent-engine opencode
```

The OpenCode engine is implemented in `src/backends/opencode/`. Configure with `cascade agents create --engine opencode` or via the Agent Configs tab in the dashboard.

## Sentry / Alerting Integration

CASCADE integrates with Sentry for alert-driven automation. When Sentry issues or metric alerts arrive, they are routed to the `alerting` agent.

- **Sentry client**: `src/sentry/` — API client and integration helpers
- **Triggers**: `src/triggers/sentry/` — `alerting-issue.ts`, `alerting-metric.ts`
- **Gadgets**: `src/gadgets/sentry/` — `GetAlertingIssue`, `GetAlertingEventDetail`, `ListAlertingEvents`
- **CLI tools**: `src/cli/alerting/` — alerting-specific commands available via `cascade-tools`
- **Agent definition**: `src/agents/definitions/alerting.yaml`

Configure the Sentry integration via the dashboard (Settings > Integrations > Alerting) or CLI.

## Dashboard

CASCADE includes a web dashboard for exploring agent runs, logs, LLM calls, and debug analyses.

### Running the Dashboard

```bash
npm run dev          # Router on :3000 (webhook receiver, tsx watch)
npm run dev:web      # Frontend on :5173 (Vite, proxies /trpc + /api to :3001)
```

> **Note:** The dashboard API (`:3001`) and router (`:3000`) are separate services. Run `npm run build && node --env-file=.env dist/dashboard.js` in a third terminal for the dashboard API.

### Production Build

```bash
npm run build:web    # Vite builds frontend to dist/web/
npm run build        # tsc compiles backend to dist/
node dist/router/index.js    # Starts the router (webhook receiver) — this is npm start
node dist/dashboard.js       # Starts the dashboard API on :3001
```

> **Note:** `npm start` runs `dist/router/index.js` (the router), **not** the dashboard. Run `node dist/dashboard.js` separately for the dashboard API.

### Architecture

The dashboard is a single-process deployment. The Hono server mounts tRPC routes (`/trpc/*`), auth routes (`/api/auth/*`), and in production serves the built frontend as static files.

- **API**: tRPC v11 via `@hono/trpc-server` for end-to-end type safety
- **Auth**: Session cookies (HTTP-only, 30-day expiry) with bcrypt password hashing
- **Frontend**: React 19 + Vite + Tailwind CSS v4 + shadcn/ui + TanStack Router
- **Type sharing**: Frontend imports `type AppRouter` from the backend (type-only, no server code in bundle)

### Key Files

- `src/api/trpc.ts` - tRPC context, procedures, auth middleware
- `src/api/router.ts` - Root router composition (exports `type AppRouter`)
- `src/api/routers/` - tRPC routers (auth, runs, projects)
- `src/api/auth/` - Login/logout Hono handlers, session resolution
- `web/src/lib/trpc.ts` - Frontend tRPC client (type-safe via AppRouter import)

## CLI (`cascade`)

CASCADE includes a `cascade` CLI for managing the platform from the terminal. It consumes the same tRPC endpoints as the web dashboard — no business logic duplication, full type safety.

### Running the CLI

In production the `cascade` binary is available globally. In development:

```bash
npm run build                    # Compile TypeScript (required before first use)
node bin/cascade.js <command>    # Run any CLI command
```

Config is stored in `~/.cascade/cli.json`. Override with env vars for CI/scripts:

```bash
export CASCADE_SERVER_URL=http://localhost:3001
export CASCADE_SESSION_TOKEN=<token>
```

<details>
<summary><strong>Full Command Reference</strong></summary>

```bash
# Auth
cascade login --server URL --email X --password Y
cascade logout
cascade whoami

# Runs
cascade runs list [--project ID] [--status running,failed] [--agent-type impl] [--limit 20]
cascade runs show <run-id>
cascade runs logs <run-id>                    # Pipe: cascade runs logs ID | grep error
cascade runs llm-calls <run-id>
cascade runs llm-call <run-id> <call-number>
cascade runs debug <run-id>                    # View debug analysis
cascade runs debug <run-id> --analyze          # Trigger new debug analysis
cascade runs debug <run-id> --analyze --wait   # Trigger and wait for completion
cascade runs trigger --project <id> --agent-type <type> [--work-item-id ID] [--model MODEL]
cascade runs retry <run-id> [--model MODEL]
cascade runs cancel <run-id> [--reason "..."]  # Cancel a running agent run

# Projects
cascade projects list
cascade projects show <id>
cascade projects create --id my-project --name "My Project" --repo owner/repo
cascade projects update <id> --model claude-sonnet-4-5-20250929
cascade projects update <id> --agent-engine llmist
cascade projects update <id> --work-item-budget 10 --watchdog-timeout 1800000
cascade projects update <id> --progress-model openrouter:google/gemini-2.5-flash-lite --progress-interval 5
cascade projects update <id> --run-links-enabled --max-in-flight-items 3
cascade projects delete <id> --yes
cascade projects integrations <id>
cascade projects integration-set <id> --category pm --provider trello --config '{"boardId":"..."}'
cascade projects credentials-list <id>
cascade projects credentials-set <id> --key GITHUB_TOKEN_IMPLEMENTER --value ghp_aaa...
cascade projects credentials-delete <id> --key GITHUB_TOKEN_IMPLEMENTER
cascade projects trigger-discover --agent <agent-type>
cascade projects trigger-list <id> [--agent <type>]
cascade projects trigger-set <id> --agent <type> --event <event> [--enable|--disable] [--params JSON]

# Users
cascade users list
cascade users create --email X --password Y --name Z [--role member|admin|superadmin]
cascade users update <id> [--name Z] [--email X] [--role member|admin|superadmin] [--password Y]
cascade users delete <id> --yes

# Organization
cascade org show
cascade org update --name "My Org"

# Agent Configs
cascade agents list --project-id ID
cascade agents create --agent-type implementation --model claude-sonnet-4-5-20250929 --project-id ID --engine llmist
cascade agents update <id> --max-iterations 30
cascade agents delete <id> --yes

# Agent Definitions (YAML-based agent definitions)
cascade definitions list
cascade definitions show <agent-type>
cascade definitions create --agent-type my-agent --file definition.yaml
cascade definitions update <agent-type> --file definition.yaml
cascade definitions delete <agent-type>
cascade definitions export <agent-type>              # Export definition as YAML to stdout
cascade definitions import --file definition.yaml    # Import/upsert from YAML file
cascade definitions reset <agent-type>               # Reset custom definition to built-in
cascade definitions triggers <agent-type>            # List supported triggers for an agent type

# Prompts (prompt partial customization)
cascade prompts default --agent-type <type>          # Print default .eta template for an agent type
cascade prompts default-partial <name>               # Print default content for a named partial
cascade prompts variables --agent-type <type>        # List available template variables
cascade prompts list-partials                         # List all configured prompt partials
cascade prompts get-partial <name>                   # Get a specific prompt partial
cascade prompts set-partial <name> --content "..."   # Create/update a prompt partial
cascade prompts reset-partial <name>                 # Delete a custom partial (reverts to default)
cascade prompts validate --agent-type <type>         # Validate current prompt template

# Webhook Logs (payload debugging)
cascade webhooklogs list [--source trello|github|jira] [--event-type X] [--limit 50]
cascade webhooklogs show <log-id>

# Webhooks
cascade webhooks list <project-id> [--github-token ghp_xxx]
cascade webhooks create <project-id> [--callback-url URL] [--github-token ghp_xxx]
cascade webhooks delete <project-id> [--callback-url URL] [--github-token ghp_xxx]
```

Global flags: `--json` (machine-readable output), `--server URL` (override server URL).

</details>

### Architecture

Each command is a thin adapter: **parse flags → call tRPC → format output**. All business logic lives server-side.

```
src/cli/dashboard/
├── _shared/          # Config, tRPC client, base class, formatters
├── login.ts          # Auth (HTTP, not tRPC)
├── logout.ts
├── whoami.ts
├── runs/             # 9 commands (list, show, logs, llm-calls, llm-call, debug, trigger, retry, cancel)
├── projects/         # 13 commands
├── users/            # 4 commands
├── org/              # 2 commands
├── agents/           # 4 commands
├── definitions/      # 9 commands (list, show, create, update, delete, export, import, reset, triggers)
├── prompts/          # 8 commands (default, default-partial, variables, list-partials, get-partial, set-partial, reset-partial, validate)
├── webhooklogs/      # 2 commands (list, show)
└── webhooks/         # 3 commands
```

The `cascade` binary is separate from `cascade-tools` (which is for agents). The `cascade-tools` binary uses a custom oclif config in `bin/cascade-tools.js` to discover all non-dashboard agent tool commands (everything under `dist/cli/` except dashboard), while `cascade` discovers only dashboard commands (`dist/cli/dashboard/`).

## User Management

Users can be managed via the CLI (recommended) or the dashboard at `/settings/users`:

```bash
cascade users create --email user@example.com --password secret --name "User Name" --role admin
cascade users list
cascade users update <id> --name "New Name" --role member
cascade users delete <id> --yes
```

As a fallback when the CLI and dashboard are unavailable:

```bash
# Generate bcrypt hash
node -e "import('bcrypt').then(b => b.default.hash('password', 10).then(console.log))"

# Insert user
psql $DATABASE_URL -c "INSERT INTO users (org_id, email, password_hash, name, role) VALUES ('my-org', 'user@example.com', '\$2b\$10\$...', 'User Name', 'admin');"
```

## Adding New Triggers

1. Create trigger handler in `src/triggers/<provider>/`
2. Implement `TriggerHandler` interface
3. Register in `src/triggers/builtins.ts` via `registerBuiltInTriggers()`

See [`src/integrations/README.md`](src/integrations/README.md) (Step 6) for a detailed walkthrough.

## Adding New Agents

Agents are defined using YAML definition files. Built-in definitions live in `src/agents/definitions/`. Custom agents can be added via the dashboard or CLI without touching source code.

1. **Write a YAML definition** — model your file on an existing one in `src/agents/definitions/` (e.g. `implementation.yaml`). The definition specifies the agent identity, supported triggers, prompt templates, and tool manifests.
2. **Import the definition** — via CLI (`cascade definitions import --file my-agent.yaml`) or dashboard (**Agent Definitions** tab).
3. **Create an `agent_configs` row** — agents require an explicit `agent_configs` entry to be enabled for a project:
   ```bash
   cascade agents create --agent-type my-agent --project-id <project-id>
   ```
4. **Configure triggers** — enable the events that should activate the agent:
   ```bash
   cascade projects trigger-set <project-id> --agent my-agent --event pm:status-changed --enable
   ```

> **Note:** Built-in agent types (`implementation`, `review`, `splitting`, etc.) ship pre-loaded as built-in definitions. Custom agents added via `cascade definitions create` are stored in the `agent_definitions` table.

## Agent Resilience Features

CASCADE integrates llmist's resilience features to ensure reliable operation during long-running sessions:

### Rate Limiting (Proactive)
- Model-specific rate limits with safety margins (80-90%)
- Tracks requests per minute (RPM), tokens per minute (TPM), and daily token usage
- Prevents 429 errors by throttling requests before hitting API limits
- Configured in `src/config/rateLimits.ts`

### Retry Strategy (Reactive)
- Handles transient failures (rate limits, 5xx errors, timeouts, connection issues)
- 5 retry attempts with exponential backoff (1s → 60s max)
- Respects `Retry-After` headers from providers
- Jitter randomization prevents thundering herd problems
- Configured in `src/config/retryConfig.ts`

### Context Compaction
- Prevents context window overflow on long-running sessions
- **All agents**: Triggers at 80% context usage, reduces to 50%, preserves 5 recent turns
- Hybrid strategy: intelligently mixes summarization and sliding-window
- Configured in `src/config/compactionConfig.ts`

### Iteration Hints
- Ephemeral trailing messages showing iteration progress
- Urgency warnings at >80%: "⚠️ ITERATION BUDGET: 17/20 - Only 3 remaining!"
- Helps LLM prioritize and wrap up before hitting iteration limits
- Configured in `src/config/hintConfig.ts`

**Monitoring**: Check `llmist-*.log` for rate limiting events. Compaction events are logged to main agent logs with details (tokens saved, reduction percentage, messages removed).

## Debugging Production Sessions

### Manual Session Download

Download session logs and card data from a Trello card for debugging:

```bash
npm run tool:download-session https://trello.com/c/abc123/card-name
# or just the card ID
npm run tool:download-session abc123
```

This downloads all `.gz` log attachments (ungzipped), plus card description, checklists, and comments into a temp directory.

### Automatic Debug Analysis

CASCADE includes a debug agent that automatically analyzes agent session logs:

1. **Automatic Trigger**: When an agent uploads a session log (`.zip` file) to a Trello card, the debug agent automatically triggers
2. **Log Analysis**: The debug agent downloads, extracts, and analyzes the session logs to identify:
   - Errors and exceptions
   - Failed gadget calls
   - Iteration loops and inefficiencies
   - Excessive LLM calls
   - Scope creep or confusion patterns
3. **Debug Card Creation**: Creates a new card in the DEBUG list with:
   - Title: `{agent-type} - {original card name}`
   - Executive summary of what went wrong
   - Key issues found
   - Timeline of events
   - Actionable recommendations
   - Link back to the original card

**Setup**: Add a `debug` list to your Trello board and configure it via the dashboard or CLI:

```bash
node bin/cascade.js projects integration-set <project-id> \
  --category pm --provider trello \
  --config '{"boardId":"BOARD_ID","lists":{"todo":"LIST_ID","inProgress":"LIST_ID","inReview":"LIST_ID","debug":"YOUR_DEBUG_LIST_ID"},...}'
```

The debug agent only analyzes logs uploaded by the authenticated CASCADE user and matching the pattern `{agent-type}-{timestamp}.zip`.
