# CASCADE - Trello-to-Code Automation Platform

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
Trello/GitHub Webhook → Router → Redis/BullMQ → Worker → TriggerRegistry → Agent → Code Changes → PR
```

- `src/router/` - Webhook receiver (enqueues jobs to Redis)
- `src/webhook/` - Shared webhook handler factory, parsers, and logging
- `src/triggers/` - Event handlers (Trello card moves, labels, GitHub PRs, attachments)
- `src/agents/` - AI agents (splitting, planning, implementation, review, debug)
- `src/gadgets/` - Tools agents can use (Trello API, Git operations, file system)

### Multi-Project Support

Projects are configured in the PostgreSQL database (`projects` table). Each project has its own Trello board, GitHub repo, and optional per-project credentials. Use `npm run db:seed -- --org <org-id>` to seed from `config/projects.json` during initial setup.

## Development

### Testing

```bash
npm test                 # Run tests
npm run test:coverage    # Run with coverage
npm run test:watch       # Watch mode
```

### Linting

```bash
npm run lint             # Check
npm run lint:fix         # Fix
npm run typecheck        # Type check
```

### Git Hooks

Lefthook runs pre-commit (lint, typecheck) and pre-push (test) hooks automatically.

## Key Directories

- `src/router/` - Router entry point (webhook receiver, enqueues to Redis)
- `src/webhook/` - Shared webhook handler factory, parsers, and logging helpers
- `src/config/` - Configuration provider, caching, Zod schemas
- `src/db/` - Database client, Drizzle schema, repositories
- `src/triggers/` - Extensible trigger system (Trello, GitHub)
- `src/agents/` - AI agent implementations
- `src/gadgets/` - Custom gadgets (Trello, Git)
- `src/cli/dashboard/` - Dashboard CLI commands (`cascade` binary)
- `src/api/` - Dashboard API (tRPC routers, auth handlers)
- `src/github/` - GitHub client, dual-persona model (personas.ts)
- `src/trello/` - Trello API client
- `src/utils/` - Utilities (logging, repo cloning, lifecycle)
- `web/` - Dashboard frontend (React 19, Vite, Tailwind v4, TanStack Router)
- `tools/` - Developer scripts (session debugging, DB seeding, secrets management)

## Environment Variables

Required:
- `DATABASE_URL` - PostgreSQL connection string (Supabase transaction pooler, port 6543)
- `REDIS_URL` - Redis connection string for BullMQ job queue (router + worker). Defaults to `redis://localhost:6379`. Run `.cascade/setup.sh` to install and start Redis locally.

Optional (infrastructure):
- `PORT` - Server port (default: 3000)
- `LOG_LEVEL` - Logging level (default: info)
- `DATABASE_SSL` - Set to `false` to disable SSL for local PostgreSQL (default: enabled)
- `CLAUDE_CODE_OAUTH_TOKEN` - For Claude Code backend (subscription auth)
- `CREDENTIAL_MASTER_KEY` - 64-char hex string (32-byte AES-256 key) for encrypting credentials at rest. Generate with `npm run credentials:generate-key`. When set, all new/updated credentials are encrypted automatically; existing plaintext credentials continue to work.
- `SENTRY_DSN` - Sentry DSN for error monitoring (router + worker)
- `SENTRY_ENVIRONMENT` - Sentry environment tag (default: NODE_ENV or 'production')
- `SENTRY_RELEASE` - Release identifier for source maps (e.g., git SHA)
- `SENTRY_TRACES_SAMPLE_RATE` - Trace sampling rate 0.0-1.0 (default: 0.1)

**Project credentials** (`GITHUB_TOKEN_IMPLEMENTER`, `GITHUB_TOKEN_REVIEWER`, `TRELLO_API_KEY`, `TRELLO_TOKEN`, LLM API keys) are stored in the `credentials` table (org-scoped, encrypted at rest when `CREDENTIAL_MASTER_KEY` is set). Integration-specific credentials (GitHub tokens, Trello keys, JIRA tokens) are linked to integrations via the `integration_credentials` join table with provider-defined roles. Non-integration credentials (LLM API keys) remain org-scoped defaults. There is no env var fallback — the database is the sole source of truth for project-scoped secrets.

## Database Configuration

CASCADE stores all project configuration in PostgreSQL (Supabase). The `config/projects.json` file is no longer used at runtime.

### Schema

- `organizations` - Organization definitions (multi-tenant support)
- `projects` - Per-project config (repo, base branch, budget, backend, and per-project overrides for model, iterations, timeouts — columns migrated from the now-dropped `cascade_defaults` table)
- `project_integrations` - Integration configs per project with `category` (pm/scm/email), `provider` (trello/jira/github/imap/gmail), `config` JSONB, and `triggers` JSONB. One PM + one SCM per project (enforced by unique constraint)
- `integration_credentials` - Links integration roles to org-scoped credential rows (e.g., `api_key` → credential #5). Roles are provider-specific: trello has `api_key`/`token`, jira has `email`/`api_token`, github has `implementer_token`/`reviewer_token`
- `agent_configs` - Per-agent-type overrides (model, iterations, engine, max_concurrency), project-scoped only (`project_id NOT NULL`)
- `credentials` - Org-scoped credentials (API keys, tokens)
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

### Credentials

Org-scoped credentials are stored in the `credentials` table. Integration-specific credentials are linked via the `integration_credentials` join table with provider-defined roles.

```bash
npx tsx tools/manage-secrets.ts create <org-id> <env-var-key> <value> [--name "..."] [--default]
npx tsx tools/manage-secrets.ts list <org-id>
npx tsx tools/manage-secrets.ts resolve <project-id>
```

### Credential Encryption at Rest

Credentials are encrypted using AES-256-GCM when `CREDENTIAL_MASTER_KEY` is set. Encryption is transparent — all callers (config provider, tRPC, CLI, tools) are unaffected.

- **Algorithm**: AES-256-GCM with 12-byte random IV, 16-byte auth tag, `orgId` as AAD
- **Storage format**: `enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>` in the existing `value` TEXT column
- **Automatic encryption**: `createCredential()` and `updateCredential()` encrypt before DB write
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
  - Agents: `implementation`, `respond-to-review`, `respond-to-ci`, `respond-to-pr-comment`, `splitting`, `planning`, `respond-to-planning-comment`
- **Reviewer** (`GITHUB_TOKEN_REVIEWER`) — reviews PRs, can approve or request changes
  - Agents: `review`

Both tokens are **required** for each project. Create org-scoped credentials, then link them to the project's SCM integration via the dashboard (Project Settings > Integrations > Source Control tab) or CLI:

```bash
cascade credentials create --name "Implementer Bot" --key GITHUB_TOKEN_IMPLEMENTER --value ghp_aaa... --default
cascade credentials create --name "Reviewer Bot" --key GITHUB_TOKEN_REVIEWER --value ghp_bbb... --default
cascade projects integration-credential-set <project-id> --category scm --role implementer_token --credential-id 5
cascade projects integration-credential-set <project-id> --category scm --role reviewer_token --credential-id 7
```

**Bot detection**: Both persona usernames are resolved at first use and cached. Trigger handlers use `isCascadeBot(login)` to check if an event came from either persona, preventing self-triggered loops.

**Loop prevention rules**:
- `respond-to-review` ONLY fires when the **reviewer** persona submits a `changes_requested` review
- `respond-to-pr-comment` skips @mentions from **any** known persona
- `check-suite-success` checks reviews from the **reviewer** persona specifically

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
- Email triggers: `email:received`

#### CLI Commands

```bash
# Discover available triggers for an agent
cascade projects trigger-discover --agent review
cascade projects trigger-discover --agent implementation

# List configured triggers for a project
cascade projects trigger-list <project-id>
cascade projects trigger-list <project-id> --agent review

# Configure a trigger (unified command)
cascade projects trigger-set <project-id> --agent review --event scm:check-suite-success --enable
cascade projects trigger-set <project-id> --agent review --event scm:check-suite-success --disable
cascade projects trigger-set <project-id> --agent review --event scm:check-suite-success --params '{"authorMode":"own"}'

# Enable implementation trigger for PM status change
cascade projects trigger-set <project-id> --agent implementation --event pm:status-changed --enable

# Disable splitting trigger for PM status changes
cascade projects trigger-set <project-id> --agent splitting --event pm:status-changed --disable
```

#### Setting via Dashboard

In the **Agent Configs** tab, each agent shows toggles for its supported triggers. Triggers with parameters (like `authorMode` for review) show additional input fields when enabled.

#### Trigger Migration

When merging to `dev` or `main`, legacy trigger configs from `project_integrations.triggers` are automatically migrated to the new `agent_trigger_configs` table. The migration is idempotent and preserves existing configurations.

### Review Agent Trigger Modes

The review agent supports multiple trigger events:

| Event | Description |
|-------|-------------|
| `scm:check-suite-success` | Trigger review when CI passes (use `authorMode` parameter: `own` or `external`) |
| `scm:review-requested` | Trigger review when a CASCADE persona is explicitly requested as reviewer |
| `scm:pr-opened` | Trigger review when a PR is opened |

```bash
# Enable review for implementer PRs only (most common)
cascade projects trigger-set <project-id> --agent review --event scm:check-suite-success --enable --params '{"authorMode":"own"}'

# Enable review for external contributor PRs
cascade projects trigger-set <project-id> --agent review --event scm:check-suite-success --enable --params '{"authorMode":"external"}'

# Enable review when explicitly requested
cascade projects trigger-set <project-id> --agent review --event scm:review-requested --enable
```

### PM Agent Trigger Modes

Splitting, planning, and implementation agents each support PM triggers:

| Event | Providers | Description |
|-------|-----------|-------------|
| `pm:status-changed` | Trello, JIRA | Trigger when card/issue moves to agent's target status |
| `pm:label-added` | All | Trigger when Ready to Process label is added |

```bash
# Enable status-changed trigger for implementation
cascade projects trigger-set <project-id> --agent implementation --event pm:status-changed --enable

# Disable status-changed for planning
cascade projects trigger-set <project-id> --agent planning --event pm:status-changed --disable

# Enable label-added trigger for splitting
cascade projects trigger-set <project-id> --agent splitting --event pm:label-added --enable
```

## Claude Code Backend

CASCADE supports using Claude Code SDK as an alternative agent backend. Configure per-project:

```json
{
  "agentBackend": {
    "default": "claude-code",
    "overrides": {
      "implementation": "claude-code",
      "review": "claude-code"
    }
  }
}
```

### Authentication

**Claude Max Subscription via `CLAUDE_CODE_OAUTH_TOKEN`:**

Generate a long-lived OAuth token for headless/containerized environments:

1. Install Claude Code CLI: `npm install -g @anthropic-ai/claude-code`
2. Authenticate: `claude login` -> select "Log in with your subscription account"
3. Generate a token: `claude setup-token`
4. Set the env var:
   ```bash
   export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...
   ```
5. The Claude Code SDK picks up the token automatically from the environment. CASCADE also creates `~/.claude.json` with `{"hasCompletedOnboarding": true}` to skip the CLI's interactive onboarding (required for headless environments).

**Docker verification test:**
```bash
bash tests/docker/claude-code-auth/run-test.sh
```

## Codex Backend

CASCADE supports OpenAI's Codex CLI as an alternative agent engine. Configure it as the default or per-project via the `agent-engine` setting:

```bash
cascade defaults set --agent-engine codex
```

### Authentication

The Codex engine supports two auth modes:

**API key (`OPENAI_API_KEY`):** Store the key as an org-scoped credential. No extra setup needed.

**Subscription (ChatGPT Plus/Pro via `CODEX_AUTH_JSON`):**

Codex CLI authenticates with an `auth.json` file at `~/.codex/auth.json` written by `codex login`. CASCADE reads this credential, writes the file before each run, and automatically captures any token refreshes the Codex CLI performs back into the database — so the credential stays current in ephemeral worker environments.

Setup:

```bash
# 1. On a machine with a browser:
codex login

# 2. Store the auth token in CASCADE:
cascade credentials create \
  --name "Codex Subscription Auth" \
  --key CODEX_AUTH_JSON \
  --value "$(cat ~/.codex/auth.json)" \
  --default

# 3. Set the engine (if not already done):
cascade defaults set --agent-engine codex
```

CASCADE then:
- Writes `~/.codex/auth.json` from the stored credential at run start
- Detects post-run token refreshes from the Codex CLI and updates the DB credential automatically

## Dashboard

CASCADE includes a web dashboard for exploring agent runs, logs, LLM calls, and debug analyses.

### Running the Dashboard

```bash
npm run dev          # Backend on :3000 (existing tsx watch)
npm run dev:web      # Frontend on :5173 (Vite, proxies /trpc + /api to :3000)
```

### Production Build

```bash
npm run build:web    # Vite builds frontend to dist/web/
npm run build        # tsc compiles backend to dist/
npm start            # Serves API + static frontend on single port
```

### Architecture

The dashboard is a single-process deployment. The Hono server mounts tRPC routes (`/trpc/*`), auth routes (`/api/auth/*`), and in production serves the built frontend as static files.

- **API**: tRPC v11 via `@hono/trpc-server` for end-to-end type safety
- **Auth**: Session cookies (HTTP-only, 30-day expiry) with bcrypt password hashing
- **Frontend**: React 19 + Vite + Tailwind CSS v4 + shadcn/ui + TanStack Router
- **Type sharing**: Frontend imports `type AppRouter` from the backend (type-only, no server code in bundle)

### User Management

Users can be managed via the CLI (recommended) or the dashboard at `/settings/users`:

```bash
# Create a user
cascade users create --email user@example.com --password secret --name "User Name" --role admin

# List all users
cascade users list

# Update a user
cascade users update <id> --name "New Name" --role member

# Delete a user
cascade users delete <id> --yes
```

Alternatively, use the dashboard at `/settings/users` to manage users via the web UI.

If the CLI and dashboard are unavailable, users can be inserted directly into the database as a fallback:

```bash
# Generate bcrypt hash
node -e "import('bcrypt').then(b => b.default.hash('password', 10).then(console.log))"

# Insert user
psql $DATABASE_URL -c "INSERT INTO users (org_id, email, password_hash, name, role) VALUES ('my-org', 'user@example.com', '\$2b\$10\$...', 'User Name', 'admin');"
```

### Key Files

- `src/api/trpc.ts` - tRPC context, procedures, auth middleware
- `src/api/router.ts` - Root router composition (exports `type AppRouter`)
- `src/api/routers/` - tRPC routers (auth, runs, projects)
- `src/api/auth/` - Login/logout Hono handlers, session resolution
- `web/src/lib/trpc.ts` - Frontend tRPC client (type-safe via AppRouter import)

## CLI (`cascade`)

CASCADE includes a `cascade` CLI for managing the platform from the terminal. It consumes the same tRPC endpoints as the web dashboard — no business logic duplication, full type safety.

### Running the CLI

In production the `cascade` binary is available globally. In development, run it via:

```bash
npm run build                    # Compile TypeScript (required before first use)
node bin/cascade.js <command>    # Run any CLI command
```

All examples below use the bare `cascade` name — substitute `node bin/cascade.js` when running locally.

### Setup

```bash
cascade login --server http://localhost:3000 --email you@example.com --password secret
cascade whoami                   # Verify session
```

Config is stored in `~/.cascade/cli.json`. Override with env vars for CI/scripts:

```bash
export CASCADE_SERVER_URL=http://localhost:3000
export CASCADE_SESSION_TOKEN=<token>
```

### Commands

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

# Projects
cascade projects list
cascade projects show <id>
cascade projects create --id my-project --name "My Project" --repo owner/repo
cascade projects update <id> --model claude-sonnet-4-5-20250929
cascade projects delete <id> --yes
cascade projects integrations <id>
cascade projects integration-set <id> --category pm --provider trello --config '{"boardId":"..."}'
cascade projects integration-credential-set <id> --category scm --role implementer_token --credential-id 5
cascade projects integration-credential-rm <id> --category scm --role implementer_token
cascade projects trigger-discover --agent <agent-type>
cascade projects trigger-list <id> [--agent <type>]
cascade projects trigger-set <id> --agent <type> --event <event> [--enable|--disable] [--params JSON]

# Users
cascade users list
cascade users create --email X --password Y --name Z [--role member|admin|superadmin]
cascade users update <id> [--name Z] [--email X] [--role member|admin|superadmin] [--password Y]
cascade users delete <id> --yes

# Credentials
cascade credentials list
cascade credentials create --name "Implementer Bot" --key GITHUB_TOKEN_IMPLEMENTER --value ghp_aaa... [--default]
cascade credentials create --name "Reviewer Bot" --key GITHUB_TOKEN_REVIEWER --value ghp_bbb... [--default]
cascade credentials update <id> --value new-secret
cascade credentials delete <id> --yes

# Defaults
cascade defaults show
cascade defaults set --model claude-sonnet-4-5-20250929 --max-iterations 25 --agent-engine claude-code

# Organization
cascade org show
cascade org update --name "My Org"

# Agent Configs
cascade agents list --project-id ID
cascade agents create --agent-type implementation --model claude-sonnet-4-5-20250929 --project-id ID
cascade agents update <id> --max-iterations 30
cascade agents delete <id> --yes

# Webhooks
cascade webhooks list <project-id> [--github-token ghp_xxx]
cascade webhooks create <project-id> [--callback-url URL] [--github-token ghp_xxx]
cascade webhooks delete <project-id> [--callback-url URL] [--github-token ghp_xxx]
```

### Global Flags

- `--json` — Machine-readable JSON output (all commands). Pipe to `jq` for scripting.
- `--server URL` — Override server URL for a single invocation.

### Architecture

Each command is a thin adapter: **parse flags → call tRPC → format output**. All business logic lives server-side.

```
src/cli/dashboard/
├── _shared/          # Config, tRPC client, base class, formatters
├── login.ts          # Auth (HTTP, not tRPC)
├── logout.ts
├── whoami.ts
├── runs/             # 6 commands
├── projects/         # 13 commands
├── users/            # 4 commands
├── credentials/      # 4 commands
├── defaults/         # 2 commands
├── org/              # 2 commands
├── agents/           # 4 commands
└── webhooks/         # 3 commands
```

The `cascade` binary is separate from `cascade-tools` (which is for agents). The `cascade-tools` binary uses a custom oclif config in `bin/cascade-tools.js` to discover only agent tool commands (`dist/cli/pm/`, `dist/cli/scm/`, `dist/cli/session/`), while `cascade` discovers only dashboard commands (`dist/cli/dashboard/`).

## Adding New Triggers

1. Create trigger handler in `src/triggers/`
2. Implement `TriggerHandler` interface
3. Register in `src/triggers/index.ts`

## Adding New Agents

1. Create agent in `src/agents/`
2. Define system prompt in `src/agents/prompts/`
3. Register in agent registry

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
- **Implementation agent**: Triggers at 70% context usage, reduces to 40%, preserves 8 recent turns
- **Other agents**: Triggers at 80% context usage, reduces to 50%, preserves 5 recent turns
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

**Setup**: Add a `debug` list to your Trello board and configure it in `config/projects.json`:

```json
{
  "trello": {
    "lists": {
      "splitting": "...",
      "planning": "...",
      "todo": "...",
      "debug": "YOUR_DEBUG_LIST_ID"
    }
  }
}
```

The debug agent only analyzes logs uploaded by the authenticated CASCADE user and matching the pattern `{agent-type}-{timestamp}.zip`.
